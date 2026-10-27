//! REST-API der Oberfläche.

use std::convert::Infallible;
use std::time::Duration;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{Local, NaiveDate};
use futures_util::Stream;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;

use super::{ApiError, ApiResult, AppState, ClientGuard};
use crate::app::Event;
use crate::dates::{Remind, Repeat, parse_natural_prefix};
use crate::settings::Settings;
use crate::vault::types::TypesFile;
use crate::vault::{Kind, Op};
use crate::{agenda, capture, git, search, update};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/info", get(info))
        .route("/vault", get(snapshot))
        .route("/ops", post(ops))
        .route("/capture", post(capture_text))
        .route("/capture/preview", get(capture_preview))
        .route("/search", get(search_nodes))
        .route("/tags", get(tags))
        .route("/agenda", get(agenda_range))
        .route("/parse", get(parse))
        .route("/link", post(link))
        .route("/types", get(get_types).put(put_types))
        .route("/settings", get(get_settings).put(put_settings))
        .route("/sync", get(sync_status).post(sync_now))
        .route("/sync/remote", put(set_remote))
        .route("/history", get(history))
        .route("/history/file", get(history_file))
        .route("/history/restore", post(history_restore))
        .route("/events", get(events))
        .route("/system/focus", post(focus))
        .route("/system/capture", post(show_capture))
        .route("/system/capture/hide", post(hide_capture))
        .route("/system/open-folder", post(open_folder))
        .route("/system/open-url", post(open_url))
        .route("/system/quit", post(quit))
        .route("/update", get(update_status))
        .route("/update/check", post(update_check))
        .route("/update/install", post(update_install))
}

fn today() -> NaiveDate {
    Local::now().date_naive()
}

fn bad(msg: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, msg.into())
}

async fn info(State(s): State<AppState>) -> Json<Value> {
    Json(json!({
        "version": env!("CARGO_PKG_VERSION"),
        "vault": s.app.vault_dir(),
        "host": git::hostname(),
        "local": s.local,
        "desktop": s.app.shell.lock().focus.is_some(),
        "gitCli": git::cli_available(),
    }))
}

async fn snapshot(State(s): State<AppState>) -> Json<Value> {
    let v = s.app.vault.lock();
    Json(json!({
        "root": crate::vault::ROOT,
        "inbox": v.inbox,
        "nodes": v.all_dtos(),
        "types": v.types.types,
        "typesError": v.types_error,
        "version": v.version,
        "vault": v.dir,
        "today": today(),
    }))
}

#[derive(Deserialize)]
struct OpsBody {
    #[serde(default)]
    client: Option<String>,
    ops: Vec<Op>,
}

async fn ops(State(s): State<AppState>, Json(body): Json<OpsBody>) -> ApiResult<Json<Value>> {
    let app = s.app.clone();
    let patch = tokio::task::spawn_blocking(move || app.apply(body.client, body.ops)).await.map_err(|e| bad(e.to_string()))??;
    Ok(Json(json!(patch)))
}

#[derive(Deserialize)]
struct CaptureBody {
    text: String,
    #[serde(default)]
    parent: Option<String>,
}

async fn capture_text(State(s): State<AppState>, Json(body): Json<CaptureBody>) -> ApiResult<Json<Value>> {
    let (id, c) = s.app.capture(&body.text, body.parent.as_deref())?;
    let node = s.app.vault.lock().dto(&id);
    Ok(Json(json!({ "id": id, "summary": c.summary, "node": node })))
}

#[derive(Deserialize)]
struct TextQuery {
    #[serde(default)]
    text: String,
}

/// Vorschau der Schnellerfassung (ohne Speichern).
async fn capture_preview(Query(q): Query<TextQuery>) -> Json<Value> {
    Json(json!(capture::parse(&q.text, Local::now().naive_local())))
}

#[derive(Deserialize)]
struct SearchQuery {
    #[serde(default)]
    q: String,
    #[serde(default)]
    limit: Option<usize>,
}

async fn search_nodes(State(s): State<AppState>, Query(q): Query<SearchQuery>) -> Json<Value> {
    let docs = s.app.vault.lock().search_docs();
    let query = search::Query::parse(&q.q);
    let limit = q.limit.unwrap_or(50).min(500);
    let hits = tokio::task::spawn_blocking(move || search::search(&docs, &query, &search::SearchContext { today: today() }, limit)).await.unwrap_or_default();
    Json(json!({ "hits": hits }))
}

async fn tags(State(s): State<AppState>, Query(q): Query<SearchQuery>) -> Json<Value> {
    let counts = s.app.vault.lock().tag_counts();
    Json(json!(search::search_tags(&counts, &q.q, q.limit.unwrap_or(30))))
}

#[derive(Deserialize)]
struct RangeQuery {
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
}

async fn agenda_range(State(s): State<AppState>, Query(q): Query<RangeQuery>) -> Json<Value> {
    let today = today();
    let from = q.from.unwrap_or(today);
    let to = q.to.unwrap_or(from + chrono::Duration::days(6)).max(from);
    let to = to.min(from + chrono::Duration::days(400));
    let v = s.app.vault.lock();
    Json(json!(agenda::agenda(&v, from, to, today)))
}

#[derive(Deserialize)]
struct ParseQuery {
    kind: String,
    q: String,
}

/// Live-Vorschau für Slash-Befehle und Feldeingaben.
async fn parse(Query(p): Query<ParseQuery>) -> Json<Value> {
    let now = Local::now().naive_local();
    let today = now.date();
    let result = match p.kind.as_str() {
        "command" => capture::parse_command(&p.q, now).map(|r| json!(r)),
        "date" => parse_natural_prefix(&p.q, now)
            .or_else(|| crate::dates::When::parse(&p.q).map(|w| (w, p.q.len())))
            .map(|(w, n)| json!({ "value": w.format(), "human": w.human_de(today), "consumed": n, "complete": n == p.q.trim_end().len() })),
        "repeat" => Repeat::parse_prefix(&p.q).map(|(r, n)| json!({ "value": r.format(), "human": r.human_de(), "consumed": n, "complete": n == p.q.trim_end().len() })),
        "remind" => {
            let list = Remind::parse_list(&p.q, now);
            (!list.is_empty()).then(|| json!({ "value": Remind::format_list(&list), "human": list.iter().map(|r| r.human_de()).collect::<Vec<_>>().join(", "), "consumed": p.q.len(), "complete": true }))
        }
        _ => None,
    };
    Json(result.unwrap_or(Value::Null))
}

#[derive(Deserialize)]
struct IdBody {
    id: String,
}

async fn link(State(s): State<AppState>, Json(b): Json<IdBody>) -> ApiResult<Json<Value>> {
    let link = s.app.vault.lock().link_to(&b.id)?;
    Ok(Json(json!({ "link": link })))
}

async fn get_types(State(s): State<AppState>) -> Json<Value> {
    let v = s.app.vault.lock();
    Json(json!({ "types": v.types.types, "error": v.types_error }))
}

async fn put_types(State(s): State<AppState>, Json(t): Json<TypesFile>) -> ApiResult<Json<Value>> {
    {
        let mut v = s.app.vault.lock();
        v.save_types(t)?;
    }
    s.app.emit(Event::Types);
    let v = s.app.vault.lock();
    Ok(Json(json!({ "types": v.types.types, "error": v.types_error })))
}

async fn get_settings(State(s): State<AppState>) -> Json<Value> {
    let settings = s.app.settings.lock().clone();
    Json(json!({ "settings": settings, "vault": s.app.vault_dir(), "defaultVault": crate::settings::default_vault() }))
}

async fn put_settings(State(s): State<AppState>, Json(mut new): Json<Settings>) -> ApiResult<Json<Value>> {
    let old = s.app.settings.lock().clone();
    new.ui_scale = crate::settings::clamp_ui_scale(new.ui_scale);
    if (new.ui_scale - old.ui_scale).abs() > f64::EPSILON {
        let zoom = s.app.shell.lock().set_zoom.clone();
        if let Some(z) = zoom {
            z(new.ui_scale);
        }
    }
    let mut warnings: Vec<String> = Vec::new();
    if new.hotkey != old.hotkey {
        let setter = s.app.shell.lock().set_hotkey.clone();
        if let Some(set) = setter
            && let Err(e) = set(new.hotkey.clone())
        {
            return Err(bad(format!("Tastenkürzel „{}“: {e:#}", new.hotkey)));
        }
    }
    if new.autostart != old.autostart
        && let Err(e) = crate::settings::set_autostart(new.autostart)
    {
        warnings.push(format!("{e:#}"));
    }
    new.save(&s.app.config_dir)?;
    let restart = new.vault != old.vault;
    *s.app.settings.lock() = new.clone();
    s.app.emit(Event::Settings);
    if new.sync_enabled && !old.sync_enabled {
        s.app.trigger_sync();
    }
    Ok(Json(json!({ "settings": new, "restartRequired": restart, "warnings": warnings })))
}

async fn sync_status(State(s): State<AppState>) -> Json<Value> {
    Json(json!(s.app.sync_status()))
}

async fn sync_now(State(s): State<AppState>) -> ApiResult<Json<Value>> {
    let status = s.app.sync_now().await?;
    Ok(Json(json!(status)))
}

#[derive(Deserialize)]
struct RemoteBody {
    url: Option<String>,
}

async fn set_remote(State(s): State<AppState>, Json(b): Json<RemoteBody>) -> ApiResult<Json<Value>> {
    let status = s.app.set_remote(b.url.filter(|u| !u.trim().is_empty())).await?;
    Ok(Json(json!(status)))
}

/// Datei einer Seite relativ zum Notizbuch.
fn page_rel(s: &AppState, id: &str) -> ApiResult<String> {
    let v = s.app.vault.lock();
    let page = v.page_of(id).ok_or_else(|| bad("Seite nicht gefunden"))?;
    let path = page.page.as_ref().map(|p| p.path.clone()).unwrap_or_default();
    if page.kind != Kind::Page {
        return Err(bad("Keine Seite"));
    }
    Ok(format!("{path}.md"))
}

#[derive(Deserialize)]
struct HistoryQuery {
    id: String,
    #[serde(default)]
    rev: Option<String>,
}

async fn history(State(s): State<AppState>, Query(q): Query<HistoryQuery>) -> ApiResult<Json<Value>> {
    let rel = page_rel(&s, &q.id)?;
    s.app.flush();
    let dir = s.app.vault_dir();
    let log = git::log(&dir, Some(&rel), 200)?;
    Ok(Json(json!({ "path": rel, "commits": log, "pending": s.app.vault.lock().pending_commit.len() })))
}

async fn history_file(State(s): State<AppState>, Query(q): Query<HistoryQuery>) -> ApiResult<Json<Value>> {
    let rel = page_rel(&s, &q.id)?;
    let rev = q.rev.ok_or_else(|| bad("Version fehlt"))?;
    let text = git::file_at(&s.app.vault_dir(), &rev, &rel)?;
    let current = std::fs::read_to_string(s.app.vault_dir().join(&rel)).unwrap_or_default();
    Ok(Json(json!({ "path": rel, "text": text, "current": current })))
}

async fn history_restore(State(s): State<AppState>, Json(q): Json<HistoryQuery>) -> ApiResult<Json<Value>> {
    let rel = page_rel(&s, &q.id)?;
    let rev = q.rev.ok_or_else(|| bad("Version fehlt"))?;
    let dir = s.app.vault_dir();
    let text = git::file_at(&dir, &rev, &rel)?.ok_or_else(|| bad("Die Seite gab es in dieser Version nicht."))?;
    // Erst den aktuellen Stand sichern, dann zurückholen.
    s.app.commit_now()?;
    crate::vault::write_atomic(&dir.join(&rel), text.as_bytes())?;
    {
        let mut v = s.app.vault.lock();
        v.reload_from_disk()?;
        v.pending_commit.insert(format!("{} (wiederhergestellt)", rel.trim_end_matches(".md")));
    }
    s.app.emit(Event::Reload);
    s.app.commit_now()?;
    Ok(Json(json!({ "ok": true })))
}

async fn events(State(s): State<AppState>) -> Sse<impl Stream<Item = Result<SseEvent, Infallible>>> {
    let guard = ClientGuard::new(s.inner.clone());
    let rx = s.app.events.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(move |msg| {
        let _keep = &guard;
        match msg {
            Ok(ev) => Some(Ok(SseEvent::default().data(serde_json::to_string(&ev).unwrap_or_default()))),
            // Zu langsam gelesen: Oberfläche soll alles neu laden.
            Err(_) => Some(Ok(SseEvent::default().data(r#"{"type":"reload"}"#))),
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

async fn focus(State(s): State<AppState>) -> Json<Value> {
    let f = s.app.shell.lock().focus.clone();
    if let Some(f) = f {
        f();
    }
    Json(json!({ "ok": true }))
}

async fn show_capture(State(s): State<AppState>) -> Json<Value> {
    let f = s.app.shell.lock().capture.clone();
    if let Some(f) = f {
        f();
    }
    Json(json!({ "ok": true }))
}

async fn hide_capture(State(s): State<AppState>) -> Json<Value> {
    let f = s.app.shell.lock().hide_capture.clone();
    if let Some(f) = f {
        f();
    }
    Json(json!({ "ok": true }))
}

async fn open_folder(State(s): State<AppState>) -> ApiResult<Json<Value>> {
    if !s.local {
        return Err(bad("Nur in der lokalen App möglich."));
    }
    open::that_detached(s.app.vault_dir())?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct UrlBody {
    url: String,
}

async fn open_url(State(s): State<AppState>, Json(b): Json<UrlBody>) -> ApiResult<Json<Value>> {
    if !s.local {
        return Err(bad("Nur in der lokalen App möglich."));
    }
    let ok = ["http://", "https://", "mailto:", "tel:"].iter().any(|p| b.url.starts_with(p));
    if !ok {
        return Err(bad("Nur Web-, Mail- und Telefonlinks werden geöffnet."));
    }
    open::that_detached(&b.url)?;
    Ok(Json(json!({ "ok": true })))
}

async fn quit(State(s): State<AppState>) -> Json<Value> {
    let f = s.app.shell.lock().quit.clone();
    if let Some(f) = f {
        f();
    }
    Json(json!({ "ok": true }))
}

// ---------------------------------------------------------------------------
// Updates (nur lokale App, siehe crate::update)
// ---------------------------------------------------------------------------

async fn update_status() -> Json<update::UpdateStatus> {
    Json(update::status())
}

fn local_app_only() -> ApiResult<()> {
    if update::enabled() { Ok(()) } else { Err(ApiError(StatusCode::FORBIDDEN, "Nur in der lokalen App verfügbar.".into())) }
}

async fn update_check() -> ApiResult<Json<update::UpdateStatus>> {
    local_app_only()?;
    let status = tokio::task::spawn_blocking(update::check).await.map_err(|e| bad(e.to_string()))?;
    Ok(Json(status))
}

/// Startet die Installation im Hintergrund; die Oberfläche verfolgt sie über `GET /api/update`.
async fn update_install() -> ApiResult<Json<update::UpdateStatus>> {
    local_app_only()?;
    update::start_install().map_err(bad)?;
    Ok(Json(update::status()))
}
