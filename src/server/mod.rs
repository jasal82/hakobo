//! HTTP-Server: REST-API, Ereignisstrom (SSE) und eingebettete Oberfläche.

mod api;

use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, Uri, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Redirect, Response};

use crate::app::App;
use crate::assets::Web;

#[derive(Clone)]
pub struct AppState {
    pub inner: Arc<Inner>,
}

pub struct Inner {
    pub app: Arc<App>,
    /// Lokaler Modus (Desktop): nur 127.0.0.1, Host-Prüfung.
    pub local: bool,
    pub token: Option<String>,
    /// Verbundene Oberflächen (offene Ereignisströme).
    pub clients: AtomicUsize,
}

impl std::ops::Deref for AppState {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.inner
    }
}

/// Fehler-Antworten als JSON `{ "error": "…" }`.
pub struct ApiError(pub StatusCode, pub String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, axum::Json(serde_json::json!({ "error": self.1 }))).into_response()
    }
}

impl<E: Into<anyhow::Error>> From<E> for ApiError {
    fn from(e: E) -> Self {
        let e: anyhow::Error = e.into();
        ApiError(StatusCode::BAD_REQUEST, format!("{e:#}"))
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

pub struct ServerConfig {
    pub app: Arc<App>,
    pub local: bool,
    pub host: String,
    pub port: u16,
    pub token: Option<String>,
}

pub async fn bind(cfg: &ServerConfig) -> anyhow::Result<(tokio::net::TcpListener, SocketAddr)> {
    let addr = format!("{}:{}", cfg.host, cfg.port);
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) if cfg.local => {
            tracing::warn!("Port {} belegt ({e}), wähle freien Port", cfg.port);
            tokio::net::TcpListener::bind(format!("{}:0", cfg.host)).await?
        }
        Err(e) => return Err(e.into()),
    };
    let local = listener.local_addr()?;
    Ok((listener, local))
}

pub async fn serve(cfg: ServerConfig, listener: tokio::net::TcpListener) -> anyhow::Result<()> {
    let state = AppState { inner: Arc::new(Inner { app: cfg.app, local: cfg.local, token: cfg.token, clients: AtomicUsize::new(0) }) };
    let app = Router::new()
        .nest("/api", api::router())
        .fallback(static_handler)
        .layer(middleware::from_fn_with_state(state.clone(), guard))
        .layer(tower_http::compression::CompressionLayer::new())
        .with_state(state);
    axum::serve(listener, app).await?;
    Ok(())
}

const COOKIE: &str = "hakobo_token";

/// Zugriffsschutz: Token (Cookie/Header/Query) und Host-Prüfung im lokalen
/// Modus (gegen DNS-Rebinding).
async fn guard(State(state): State<AppState>, req: Request, next: Next) -> Response {
    if state.local {
        let host = req.headers().get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or("");
        let hostname = host.rsplit_once(':').map(|(h, _)| h).unwrap_or(host);
        if !matches!(hostname, "127.0.0.1" | "localhost" | "[::1]") {
            return (StatusCode::FORBIDDEN, "Zugriff nur lokal erlaubt").into_response();
        }
    }
    let Some(token) = state.token.clone() else { return next.run(req).await };
    let uri = req.uri().clone();
    // Token in der URL → Cookie setzen und ohne Token weiterleiten.
    if let Some(q) = uri.query()
        && let Some(t) = q.split('&').find_map(|kv| kv.strip_prefix("token="))
        && t == token
    {
        let rest: Vec<&str> = q.split('&').filter(|kv| !kv.starts_with("token=")).collect();
        let target = if rest.is_empty() { uri.path().to_string() } else { format!("{}?{}", uri.path(), rest.join("&")) };
        let mut resp = Redirect::to(&target).into_response();
        let cookie = format!("{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000");
        resp.headers_mut().insert(header::SET_COOKIE, HeaderValue::from_str(&cookie).expect("Cookie"));
        return resp;
    }
    if authorized(req.headers(), &token) {
        return next.run(req).await;
    }
    if uri.path().starts_with("/api") {
        return ApiError(StatusCode::UNAUTHORIZED, "Nicht angemeldet".into()).into_response();
    }
    (StatusCode::UNAUTHORIZED, axum::response::Html(LOGIN_PAGE)).into_response()
}

fn authorized(headers: &HeaderMap, token: &str) -> bool {
    if let Some(auth) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok())
        && auth.strip_prefix("Bearer ").is_some_and(|t| t == token)
    {
        return true;
    }
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .any(|c| c.trim() == format!("{COOKIE}={token}"))
}

const LOGIN_PAGE: &str = r#"<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hakobo – Anmeldung</title>
<style>body{font:14px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f4f2;color:#1c1917}form{background:#fff;padding:2rem;border:1px solid #e6e4e0;border-radius:12px;box-shadow:0 12px 28px -10px rgba(28,25,23,.2);width:min(360px,90vw)}h1{font-size:1.15rem;font-weight:600;margin:0 0 .25rem}p{color:#6b665f;margin:0 0 1.25rem}input{width:100%;box-sizing:border-box;padding:.6rem .75rem;border:1px solid #d3d0ca;border-radius:7px;background:#fff;font:inherit}input:focus{outline:none;border-color:#16946a;box-shadow:0 0 0 3px rgba(22,148,106,.28)}button{margin-top:1rem;width:100%;padding:.6rem;border:0;border-radius:7px;background:#1c1917;color:#fff;font:inherit;font-weight:500;cursor:pointer}@media(prefers-color-scheme:dark){body{background:#111;color:#ecebe8}form{background:#181818;border-color:#2a2a2a}p{color:#94918b}input{background:#111;border-color:#3a3a3a;color:inherit}button{background:#ecebe8;color:#181818}}</style>
<form method="get" action="/"><h1>Hakobo</h1><p>Bitte das Zugangstoken eingeben, das beim Start des Servers angezeigt wurde.</p><input name="token" type="password" autofocus placeholder="Zugangstoken" autocomplete="current-password"><button>Anmelden</button></form></html>"#;

async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    if let Some(file) = Web::get(path) {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        let cache = if path.starts_with("assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
        return Response::builder()
            .header(header::CONTENT_TYPE, mime.as_ref())
            .header(header::CACHE_CONTROL, cache)
            .body(Body::from(file.data.into_owned()))
            .expect("Antwort");
    }
    // SPA-Fallback
    match Web::get("index.html") {
        Some(file) => Response::builder()
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header(header::CACHE_CONTROL, "no-cache")
            .body(Body::from(file.data.into_owned()))
            .expect("Antwort"),
        None => (StatusCode::NOT_FOUND, "Die Weboberfläche ist nicht eingebettet. Bitte `npm run build` ausführen und neu kompilieren.").into_response(),
    }
}

/// Zählt verbundene Oberflächen; wird mit dem Ereignisstrom freigegeben.
pub struct ClientGuard(Arc<Inner>);

impl ClientGuard {
    pub fn new(inner: Arc<Inner>) -> Self {
        inner.clients.fetch_add(1, Ordering::SeqCst);
        Self(inner)
    }
}

impl Drop for ClientGuard {
    fn drop(&mut self) {
        self.0.clients.fetch_sub(1, Ordering::SeqCst);
    }
}
