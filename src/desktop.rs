// Copyright (C) 2026 Johannes Asal
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

//! Desktop-Hülle: Hauptfenster (WebView2/WKWebView, rahmenlos mit eigener
//! Titelleiste), Erfassungsfenster für den globalen Hotkey, Symbol im
//! Infobereich (Tray).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use anyhow::{Result, anyhow};
use global_hotkey::hotkey::HotKey;
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tao::dpi::{LogicalSize, PhysicalPosition, PhysicalSize};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop, EventLoopBuilder, EventLoopProxy};
use tao::window::{Icon, Window, WindowBuilder};
use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use wry::{NewWindowResponse, WebContext, WebView, WebViewBuilder};

use crate::app::{App, Shell};

pub enum UserEvent {
    MainIpc(String),
    CaptureIpc(String),
    Focus,
    ShowCapture,
    ToggleCapture,
    HideCapture,
    Menu(String),
    SetHotkey(String, mpsc::Sender<Result<(), String>>),
    /// Schriftgröße/Zoom der Oberfläche.
    Zoom(f64),
    Title(String),
    Quit,
}

pub struct Desktop {
    event_loop: EventLoop<UserEvent>,
}

pub struct RunOptions {
    pub app: Arc<App>,
    pub base_url: String,
    pub token: String,
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub dark: bool,
    /// Ohne Fenster starten (nur Tray), z. B. beim Autostart.
    pub start_hidden: bool,
    /// Wird beim Beenden aufgerufen (speichern, Instanzdatei entfernen).
    pub on_exit: Box<dyn Fn()>,
}

#[derive(Serialize, Deserialize, Default)]
struct WindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

fn icon() -> Option<Icon> {
    Icon::from_rgba(crate::assets::ICON_RGBA.to_vec(), 128, 128).ok()
}

fn platform() -> &'static str {
    if cfg!(target_os = "macos") { "macos" } else { "windows" }
}

type Proxy = Arc<Mutex<EventLoopProxy<UserEvent>>>;

fn send(proxy: &Proxy, e: UserEvent) {
    let _ = proxy.lock().send_event(e);
}

impl Desktop {
    pub fn new() -> Self {
        Self { event_loop: EventLoopBuilder::<UserEvent>::with_user_event().build() }
    }

    /// Rückrufe für die App (aus beliebigen Threads).
    pub fn shell(&self) -> Shell {
        let proxy: Proxy = Arc::new(Mutex::new(self.event_loop.create_proxy()));
        let p1 = proxy.clone();
        let p2 = proxy.clone();
        let p3 = proxy.clone();
        let p4 = proxy.clone();
        let p5 = proxy.clone();
        let p6 = proxy;
        Shell {
            focus: Some(Arc::new(move || send(&p1, UserEvent::Focus))),
            capture: Some(Arc::new(move || send(&p2, UserEvent::ShowCapture))),
            hide_capture: Some(Arc::new(move || send(&p3, UserEvent::HideCapture))),
            quit: Some(Arc::new(move || send(&p4, UserEvent::Quit))),
            set_hotkey: Some(Arc::new(move |hk: String| {
                let (tx, rx) = mpsc::channel();
                send(&p5, UserEvent::SetHotkey(hk, tx));
                match rx.recv_timeout(Duration::from_secs(3)) {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(e)) => Err(anyhow!(e)),
                    Err(_) => Err(anyhow!("Keine Antwort vom Fenster")),
                }
            })),
            set_zoom: Some(Arc::new(move |z: f64| send(&p6, UserEvent::Zoom(z)))),
        }
    }

    /// Öffnet die Fenster. Kehrt nur bei einem Fehler zurück (dann kann auf
    /// den Browser ausgewichen werden); sonst endet der Prozess hier.
    pub fn run(self, opts: RunOptions) -> Result<()> {
        let event_loop = self.event_loop;
        let proxy: Proxy = Arc::new(Mutex::new(event_loop.create_proxy()));
        let state_file = opts.config_dir.join("window.json");
        let saved: Option<WindowState> = std::fs::read_to_string(&state_file).ok().and_then(|t| serde_json::from_str(&t).ok());

        // -- Hauptfenster -------------------------------------------------
        let mut builder = WindowBuilder::new()
            .with_title("Hakobo")
            .with_inner_size(LogicalSize::new(1280.0, 860.0))
            .with_min_inner_size(LogicalSize::new(560.0, 420.0))
            .with_window_icon(icon())
            .with_visible(false);
        #[cfg(windows)]
        {
            use tao::platform::windows::WindowBuilderExtWindows;
            builder = builder.with_decorations(false).with_undecorated_shadow(true).with_taskbar_icon(icon());
        }
        #[cfg(target_os = "macos")]
        {
            use tao::platform::macos::WindowBuilderExtMacOS;
            builder = builder
                .with_titlebar_transparent(true)
                .with_title_hidden(true)
                .with_fullsize_content_view(true)
                .with_traffic_light_inset(tao::dpi::LogicalPosition::new(16.0, 18.0));
        }
        if let Some(s) = &saved
            && s.width >= 400
            && s.height >= 300
            && position_visible(&event_loop, s)
        {
            builder = builder.with_inner_size(PhysicalSize::new(s.width, s.height)).with_position(PhysicalPosition::new(s.x, s.y));
        }
        let window = builder.build(&event_loop).map_err(|e| anyhow!("Fenster: {e}"))?;
        if saved.as_ref().is_some_and(|s| s.maximized) {
            window.set_maximized(true);
        }
        let mut context = WebContext::new(Some(opts.data_dir.clone()));
        let webview = build_main_webview(&window, &mut context, &proxy, &opts)?;

        // -- Erfassungsfenster (versteckt, erscheint per Hotkey) -----------
        let mut cbuilder = WindowBuilder::new()
            .with_title("Hakobo – Erfassen")
            .with_inner_size(LogicalSize::new(CAPTURE_SIZE.0, CAPTURE_SIZE.1))
            .with_decorations(false)
            .with_resizable(false)
            .with_always_on_top(true)
            .with_transparent(true)
            .with_window_icon(icon())
            .with_visible(false);
        #[cfg(windows)]
        {
            use tao::platform::windows::WindowBuilderExtWindows;
            cbuilder = cbuilder.with_skip_taskbar(true).with_undecorated_shadow(false);
        }
        let capture = cbuilder.build(&event_loop).map_err(|e| anyhow!("Erfassungsfenster: {e}"))?;
        let capture_view = build_capture_webview(&capture, &mut context, &proxy, &opts)?;

        apply_zoom(&webview, &capture_view, &capture, opts.app.settings.lock().ui_scale);

        // -- Tray ---------------------------------------------------------
        let hotkey_label = |hk: &str| format!("Schnell erfassen\t{}", hk.replace("Ctrl", "Strg").replace("Shift", "Umschalt").replace("Space", "Leertaste"));
        let hotkey_now = opts.app.settings.lock().hotkey.clone();
        let menu = Menu::new();
        let item_open = MenuItem::with_id("open", "Hakobo öffnen", true, None);
        let item_capture = MenuItem::with_id("capture", hotkey_label(&hotkey_now), true, None);
        let item_sync = MenuItem::with_id("sync", "Jetzt synchronisieren", true, None);
        let item_quit = MenuItem::with_id("quit", "Beenden", true, None);
        let _ = menu.append_items(&[&item_open, &item_capture, &item_sync, &PredefinedMenuItem::separator(), &item_quit]);
        let tray_icon = tray_icon::Icon::from_rgba(crate::assets::TRAY_RGBA.to_vec(), 32, 32).ok();
        let mut tray_builder = TrayIconBuilder::new().with_tooltip("Hakobo").with_menu(Box::new(menu)).with_menu_on_left_click(false);
        if let Some(i) = tray_icon {
            tray_builder = tray_builder.with_icon(i);
        }
        let tray = match tray_builder.build() {
            Ok(t) => Some(t),
            Err(e) => {
                tracing::warn!("Tray-Symbol nicht verfügbar: {e}");
                None
            }
        };
        {
            let p = proxy.clone();
            MenuEvent::set_event_handler(Some(move |e: MenuEvent| send(&p, UserEvent::Menu(e.id.0.clone()))));
            let p = proxy.clone();
            TrayIconEvent::set_event_handler(Some(move |e: TrayIconEvent| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                    send(&p, UserEvent::Focus);
                }
            }));
        }

        // -- Globaler Hotkey ----------------------------------------------
        let hotkeys = GlobalHotKeyManager::new().map_err(|e| tracing::warn!("Globale Tastenkürzel nicht verfügbar: {e}")).ok();
        let mut current_hotkey: Option<HotKey> = None;
        if let Some(m) = &hotkeys {
            match hotkey_now.parse::<HotKey>() {
                Ok(hk) => match m.register(hk) {
                    Ok(()) => current_hotkey = Some(hk),
                    Err(e) => tracing::warn!("Tastenkürzel {hotkey_now} nicht verfügbar: {e}"),
                },
                Err(e) => tracing::warn!("Tastenkürzel {hotkey_now} ungültig: {e}"),
            }
            let p = proxy.clone();
            GlobalHotKeyEvent::set_event_handler(Some(move |e: GlobalHotKeyEvent| {
                if e.state == HotKeyState::Pressed {
                    send(&p, UserEvent::ToggleCapture);
                }
            }));
        }

        if !opts.start_hidden {
            window.set_visible(true);
            window.set_focus();
        }

        let app = opts.app.clone();
        let on_exit = opts.on_exit;
        let main_id = window.id();
        let capture_id = capture.id();
        let mut capture_shown_at: Option<Instant> = None;
        let mut normal: Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> = if window.is_maximized() {
            saved.as_ref().map(|s| (PhysicalPosition::new(s.x, s.y), PhysicalSize::new(s.width, s.height)))
        } else {
            window.outer_position().ok().map(|p| (p, window.inner_size()))
        };

        event_loop.run(move |event, _, control_flow| {
            *control_flow = ControlFlow::Wait;
            // Diese Objekte müssen so lange leben wie die Ereignisschleife.
            let _ = (&context, &tray, &hotkeys);
            let exit = |cf: &mut ControlFlow, window: &Window, normal| {
                save_state(window, normal, &state_file);
                on_exit();
                *cf = ControlFlow::Exit;
            };
            match event {
                Event::WindowEvent { window_id, event: WindowEvent::Moved(_) | WindowEvent::Resized(_), .. }
                    if window_id == main_id && !window.is_maximized() && !window.is_minimized() =>
                {
                    if let Ok(p) = window.outer_position() {
                        normal = Some((p, window.inner_size()));
                    }
                    notify_state(&window, &webview);
                }
                Event::WindowEvent { window_id, event: WindowEvent::Resized(_), .. } if window_id == main_id => notify_state(&window, &webview),
                Event::WindowEvent { window_id, event: WindowEvent::CloseRequested, .. } => {
                    if window_id == capture_id {
                        capture.set_visible(false);
                    } else if app.settings.lock().close_to_tray && tray.is_some() {
                        save_state(&window, normal, &state_file);
                        window.set_visible(false);
                    } else {
                        exit(control_flow, &window, normal);
                    }
                }
                Event::WindowEvent { window_id, event: WindowEvent::Focused(false), .. } if window_id == capture_id => {
                    // Kurz nach dem Zeigen kann der Fokus noch wechseln.
                    if capture_shown_at.is_some_and(|t| t.elapsed() > Duration::from_millis(400)) {
                        capture.set_visible(false);
                    }
                }
                Event::UserEvent(UserEvent::MainIpc(msg)) => match msg.as_str() {
                    "drag" => {
                        let _ = window.drag_window();
                    }
                    "minimize" => window.set_minimized(true),
                    "maximize" => {
                        window.set_maximized(!window.is_maximized());
                        notify_state(&window, &webview);
                    }
                    "close" => {
                        if app.settings.lock().close_to_tray && tray.is_some() {
                            save_state(&window, normal, &state_file);
                            window.set_visible(false);
                        } else {
                            exit(control_flow, &window, normal);
                        }
                    }
                    "quit" => exit(control_flow, &window, normal),
                    "ready" => notify_state(&window, &webview),
                    _ => {}
                },
                Event::UserEvent(UserEvent::CaptureIpc(msg)) => {
                    if msg == "hide" {
                        capture.set_visible(false);
                    } else if let Some(id) = msg.strip_prefix("open:") {
                        capture.set_visible(false);
                        show_main(&window);
                        app.navigate(id);
                    } else if msg == "drag" {
                        let _ = capture.drag_window();
                    }
                }
                Event::UserEvent(UserEvent::Focus) => show_main(&window),
                Event::UserEvent(UserEvent::ShowCapture) => {
                    show_capture(&capture, &capture_view, &window);
                    capture_shown_at = Some(Instant::now());
                }
                Event::UserEvent(UserEvent::ToggleCapture) => {
                    if capture.is_visible() {
                        capture.set_visible(false);
                    } else {
                        show_capture(&capture, &capture_view, &window);
                        capture_shown_at = Some(Instant::now());
                    }
                }
                Event::UserEvent(UserEvent::HideCapture) => capture.set_visible(false),
                Event::UserEvent(UserEvent::Menu(id)) => match id.as_str() {
                    "open" => show_main(&window),
                    "capture" => {
                        show_capture(&capture, &capture_view, &window);
                        capture_shown_at = Some(Instant::now());
                    }
                    "sync" => app.trigger_sync(),
                    "quit" => exit(control_flow, &window, normal),
                    _ => {}
                },
                Event::UserEvent(UserEvent::SetHotkey(hk, reply)) => {
                    let result = (|| -> Result<(), String> {
                        let m = hotkeys.as_ref().ok_or("Globale Tastenkürzel sind nicht verfügbar.")?;
                        let new: HotKey = hk.parse().map_err(|e| format!("{e}"))?;
                        if let Some(old) = current_hotkey.take() {
                            let _ = m.unregister(old);
                        }
                        match m.register(new) {
                            Ok(()) => {
                                current_hotkey = Some(new);
                                item_capture.set_text(hotkey_label(&hk));
                                Ok(())
                            }
                            Err(e) => Err(format!("bereits von einem anderen Programm belegt ({e})")),
                        }
                    })();
                    let _ = reply.send(result);
                }
                Event::UserEvent(UserEvent::Title(t)) => window.set_title(&t),
                Event::UserEvent(UserEvent::Zoom(z)) => apply_zoom(&webview, &capture_view, &capture, z),
                Event::UserEvent(UserEvent::Quit) => exit(control_flow, &window, normal),
                _ => {}
            }
        })
    }
}

/// Schriftgröße (Zoom) beider Fenster; das Erfassungsfenster wächst mit.
/// Größe des Erfassungsfensters bei 100 % (logische Pixel). Die Karte darin
/// ist 688 px breit; der Rest ist transparenter Rand für ihren Schatten
/// (siehe `.capture-app` in capture.css).
const CAPTURE_SIZE: (f64, f64) = (744.0, 460.0);

fn apply_zoom(main: &WebView, capture_view: &WebView, capture: &Window, z: f64) {
    let z = crate::settings::clamp_ui_scale(z);
    if let Err(e) = main.zoom(z) {
        tracing::warn!("Zoom nicht möglich: {e}");
    }
    let _ = capture_view.zoom(z);
    capture.set_inner_size(LogicalSize::new(CAPTURE_SIZE.0 * z, CAPTURE_SIZE.1 * z));
}

fn show_main(window: &Window) {
    window.set_visible(true);
    window.set_minimized(false);
    window.set_focus();
}

/// Zeigt das Erfassungsfenster im oberen Drittel des aktuellen Bildschirms.
fn show_capture(capture: &Window, view: &WebView, main: &Window) {
    let monitor = main.current_monitor().filter(|_| main.is_visible()).or_else(|| capture.primary_monitor()).or_else(|| capture.current_monitor());
    if let Some(m) = monitor {
        let size = capture.outer_size();
        let (mp, ms) = (m.position(), m.size());
        let x = mp.x + (ms.width as i32 - size.width as i32) / 2;
        let y = mp.y + (ms.height as f64 * 0.18) as i32;
        capture.set_outer_position(PhysicalPosition::new(x, y));
    }
    capture.set_visible(true);
    capture.set_focus();
    let _ = view.focus();
    let _ = view.evaluate_script("window.__hakoboCapture && window.__hakoboCapture.show()");
}

fn init_script(kind: &str) -> String {
    // Läuft vor dem Parsen des Dokuments: `documentElement` gibt es dann noch nicht.
    format!(
        "window.__HAKOBO_DESKTOP__ = {{ platform: '{p}', window: '{kind}' }}; \
         (function mark() {{ var d = document.documentElement; if (d) d.classList.add('is-desktop', 'is-desktop-{p}'); else document.addEventListener('readystatechange', mark, {{ once: true }}); }})();",
        p = platform()
    )
}

fn build_main_webview(window: &Window, context: &mut WebContext, proxy: &Proxy, opts: &RunOptions) -> Result<WebView> {
    let ipc = proxy.clone();
    let title = proxy.clone();
    let base = opts.base_url.clone();
    let token = opts.token.clone();
    let background = if opts.dark { (17, 17, 17, 255) } else { (244, 244, 242, 255) };
    let builder = WebViewBuilder::new_with_web_context(context)
        .with_url(format!("{}/?token={}", opts.base_url, opts.token))
        .with_initialization_script(init_script("main"))
        .with_background_color(background)
        .with_devtools(cfg!(debug_assertions))
        .with_clipboard(true)
        // Zoom steuert Hakobo selbst (Einstellung Schriftgröße).
        .with_hotkeys_zoom(false)
        .with_ipc_handler(move |req| send(&ipc, UserEvent::MainIpc(req.body().clone())))
        .with_document_title_changed_handler(move |t| send(&title, UserEvent::Title(t)))
        .with_new_window_req_handler(move |url, _features| {
            open_external(&url, &base, &token);
            NewWindowResponse::Deny
        });
    #[cfg(windows)]
    let builder = {
        use wry::WebViewBuilderExtWindows;
        builder.with_browser_accelerator_keys(false)
    };
    builder.build(window).map_err(|e| anyhow!("WebView: {e}"))
}

fn build_capture_webview(window: &Window, context: &mut WebContext, proxy: &Proxy, opts: &RunOptions) -> Result<WebView> {
    let ipc = proxy.clone();
    let base = opts.base_url.clone();
    let token = opts.token.clone();
    let builder = WebViewBuilder::new_with_web_context(context)
        .with_url(format!("{}/capture?token={}", opts.base_url, opts.token))
        .with_initialization_script(init_script("capture"))
        .with_transparent(true)
        .with_background_color((0, 0, 0, 0))
        .with_devtools(cfg!(debug_assertions))
        .with_clipboard(true)
        // Zoom steuert Hakobo selbst (Einstellung Schriftgröße).
        .with_hotkeys_zoom(false)
        .with_ipc_handler(move |req| send(&ipc, UserEvent::CaptureIpc(req.body().clone())))
        .with_new_window_req_handler(move |url, _features| {
            open_external(&url, &base, &token);
            NewWindowResponse::Deny
        });
    #[cfg(windows)]
    let builder = {
        use wry::WebViewBuilderExtWindows;
        builder.with_browser_accelerator_keys(false)
    };
    builder.build(window).map_err(|e| anyhow!("WebView (Erfassen): {e}"))
}

/// Links aus der Oberfläche im Standardbrowser öffnen.
fn open_external(url: &str, base: &str, token: &str) {
    let target = if url.starts_with(base) {
        let sep = if url.contains('?') { '&' } else { '?' };
        format!("{url}{sep}token={token}")
    } else {
        url.to_string()
    };
    if target.starts_with("http://") || target.starts_with("https://") || target.starts_with("mailto:") {
        let _ = open::that_detached(target);
    }
}

fn notify_state(window: &Window, webview: &WebView) {
    let js = format!("window.__hakoboWindow && window.__hakoboWindow({{ maximized: {} }})", window.is_maximized());
    let _ = webview.evaluate_script(&js);
}

fn save_state(window: &Window, normal: Option<(PhysicalPosition<i32>, PhysicalSize<u32>)>, file: &Path) {
    let maximized = window.is_maximized();
    let (pos, size) = normal.unwrap_or_else(|| (window.outer_position().unwrap_or(PhysicalPosition::new(0, 0)), window.inner_size()));
    let state = WindowState { x: pos.x, y: pos.y, width: size.width, height: size.height, maximized };
    if let Ok(json) = serde_json::to_string(&state) {
        let _ = std::fs::write(file, json);
    }
}

fn position_visible(event_loop: &EventLoop<UserEvent>, s: &WindowState) -> bool {
    event_loop.available_monitors().any(|m| {
        let p = m.position();
        let sz = m.size();
        s.x + 80 >= p.x && s.y >= p.y - 10 && s.x + 80 < p.x + sz.width as i32 && s.y + 40 < p.y + sz.height as i32
    })
}
