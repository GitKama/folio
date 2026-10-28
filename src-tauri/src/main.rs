#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod dialogs;
mod files;
mod pdf;
use base64::Engine;
use files::{Document, Result};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};

#[derive(Default)]
struct Session {
    doc: Option<Document>,
    draft: String,
    recent: Vec<Value>,
    remote: bool,
    conflict: Option<String>,
}
#[derive(Clone)]
struct State {
    session: Arc<Mutex<Session>>,
    print: Arc<Mutex<String>>,
    settings: PathBuf,
}
fn emit(app: &tauri::AppHandle, event: &str, value: Value) {
    let _ = app.emit_to("main", "folio", json!({"event":event,"value":value}));
}
fn dirty(s: &Session) -> bool {
    s.doc
        .as_ref()
        .is_some_and(|d| d.unsaved || files::normalize(&d.content) != files::normalize(&s.draft))
}
fn adopt(s: &mut Session, mut doc: Document, settings: &Path) -> Document {
    if let Some(path) = &doc.path {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let token = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        doc.base_url = Some(format!("http://folio.localhost/asset/{token}/"));
        s.recent.retain(|r| r["path"].as_str() != path.to_str());
        s.recent.insert(0, json!({"path":path,"name":doc.name}));
        s.recent.truncate(15);
        if let Some(parent) = settings.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(settings, serde_json::to_vec(&s.recent).unwrap());
    }
    s.draft = doc.content.clone();
    s.doc = Some(doc.clone());
    s.conflict = None;
    doc
}
fn save(
    s: &mut Session,
    app: &tauri::AppHandle,
    state: &State,
    mut save_as: bool,
) -> Result<Value> {
    let Some(mut format) = s.doc.clone() else {
        return Ok(json!({"canceled":true}));
    };
    let mut path = format.path.clone();
    let mut expected = format.revision.clone();
    if !save_as {
        if let Some(p) = &path {
            let actual = files::revision(p)?;
            if actual != expected {
                match dialogs::choice(true).as_str() {
                    "Save a copy" => save_as = true,
                    "Replace disk version" => expected = actual,
                    _ => return Ok(json!({"canceled":true})),
                }
            }
        }
    }
    if save_as || path.is_none() {
        path = dialogs::save_file(&format.name);
        let Some(p) = &path else {
            return Ok(json!({"canceled":true}));
        };
        expected = files::revision(p)?;
        format.encoding = "UTF-8".into();
        format.bom = false;
    }
    let doc = files::write(path.as_ref().unwrap(), &s.draft, &format, &expected)?;
    let doc = adopt(s, doc, &state.settings);
    emit(
        app,
        "document",
        json!({"document":doc,"saved":true,"draft":s.draft}),
    );
    Ok(json!({"document":doc}))
}
fn confirm(s: &mut Session, app: &tauri::AppHandle, state: &State) -> Result<bool> {
    if !dirty(s) {
        return Ok(true);
    }
    match dialogs::choice(false).as_str() {
        "Save" => Ok(save(s, app, state, false)?["canceled"] != true && !dirty(s)),
        "Discard" => Ok(true),
        _ => Ok(false),
    }
}
fn open_doc(path: &Path, s: &mut Session, app: &tauri::AppHandle, state: &State) -> Result<Value> {
    files::read(path)?;
    if !confirm(s, app, state)? {
        return Ok(Value::Null);
    }
    Ok(json!(adopt(s, files::read(path)?, &state.settings)))
}
fn text(v: &Value) -> Result<&str> {
    v.as_str().ok_or_else(|| "Expected text.".into())
}
fn local_image(s: &Session, url: &str) -> Result<(Vec<u8>, &'static str)> {
    let url = url::Url::parse(&url.replace("folio://localhost/", "http://folio.localhost/"))
        .map_err(|e| e.to_string())?;
    let base = s
        .doc
        .as_ref()
        .and_then(|d| d.base_url.as_ref())
        .ok_or("No document assets are available")?;
    if !url.as_str().starts_with(base) {
        return Err("Image is not part of the current document.".into());
    }
    let root = s
        .doc
        .as_ref()
        .and_then(|d| d.path.as_ref())
        .and_then(|p| p.parent())
        .ok_or("Open the document from disk to load its images.")?;
    let base_path = url::Url::parse(base)
        .map_err(|e| e.to_string())?
        .path()
        .len();
    let relative = percent_encoding::percent_decode_str(&url.path()[base_path..])
        .decode_utf8()
        .map_err(|e| e.to_string())?;
    files::image(root, &relative)
}
fn clipboard(payload: &Value, html: bool) -> Result<Value> {
    let plain = if html {
        text(&payload["text"])?
    } else {
        text(payload)?
    };
    if plain.len() > 12 * 1024 * 1024 {
        return Err("Clipboard content is too large.".into());
    }
    let markup = if html {
        Some(text(&payload["html"])?)
    } else {
        None
    };
    if markup.is_some_and(|m| m.len().max(m.encode_utf16().count() * 2) > 80 * 1024)
        || (html && plain.len().max(plain.encode_utf16().count() * 2) > 80 * 1024)
    {
        return Err(
            "This document exceeds the Teams message limit. Copy a shorter section.".into(),
        );
    }
    let _guard = clipboard_win::Clipboard::new_attempts(20).map_err(|e| e.to_string())?;
    clipboard_win::raw::set_string(plain).map_err(|e| e.to_string())?;
    if let Some(markup) = markup {
        let format = clipboard_win::register_format("HTML Format")
            .ok_or("Cannot register HTML clipboard format")?;
        clipboard_win::raw::set_html(format.get(), markup).map_err(|e| e.to_string())?;
    }
    Ok(json!(true))
}
fn action(action: &str, payload: Value, app: &tauri::AppHandle, state: &State) -> Result<Value> {
    #[cfg(feature = "test-harness")]
    if action == "test-config" {
        return dialogs::configure(payload);
    }
    #[cfg(feature = "test-harness")]
    if action == "test-clipboard" && std::env::var_os("FOLIO_TEST_ROOT").is_some() {
        let _guard = clipboard_win::Clipboard::new_attempts(20).map_err(|e| e.to_string())?;
        let mut plain = Vec::new();
        clipboard_win::raw::get_string(&mut plain).map_err(|e| e.to_string())?;
        let mut html = Vec::new();
        let format = clipboard_win::register_format("HTML Format").unwrap();
        clipboard_win::raw::get_vec(format.get(), &mut html).map_err(|e| e.to_string())?;
        return Ok(
            json!({"text":String::from_utf8_lossy(&plain),"html":String::from_utf8_lossy(&html)}),
        );
    }
    if action == "copy" || action == "copy-teams" {
        return clipboard(&payload, action == "copy-teams");
    }
    let mut s = state
        .session
        .lock()
        .map_err(|_| "Document state unavailable")?;
    match action {
        "draft" => {
            let draft = text(&payload["content"])?;
            if draft.len() > files::MAX_DOCUMENT * 3 {
                return Err("Document is too large.".into());
            }
            if payload["path"] == json!(s.doc.as_ref().and_then(|d| d.path.clone())) {
                s.draft = draft.into();
            }
            Ok(Value::Null)
        }
        "recent" => Ok(json!(s.recent)),
        "preferences" => Ok(fs::read(state.settings.with_file_name("preferences.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .unwrap_or(Value::Null)),
        "set-preferences" => {
            if !payload.is_object() || payload.to_string().len() > 16384 {
                return Err("Invalid preferences.".into());
            }
            if let Some(parent) = state.settings.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(
                state.settings.with_file_name("preferences.json"),
                payload.to_string(),
            )
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "initial" => {
            let arg = std::env::args().skip(1).find(|a| !a.starts_with('-'));
            if let Some(path) = arg {
                let path = PathBuf::from(path);
                let path = if path.is_absolute() {
                    path
                } else {
                    std::env::current_dir()
                        .map_err(|e| e.to_string())?
                        .join(path)
                };
                open_doc(&path, &mut s, app, state)
            } else {
                Ok(Value::Null)
            }
        }
        "open" => {
            let path = dialogs::open_file();
            if let Some(p) = path {
                open_doc(&p, &mut s, app, state)
            } else {
                Ok(Value::Null)
            }
        }
        "recent-open" | "drop" => {
            let path = Path::new(text(&payload)?);
            if action == "recent-open" && !s.recent.iter().any(|r| r["path"] == payload) {
                return Err("This file is not in recent documents.".into());
            }
            let doc = open_doc(path, &mut s, app, state)?;
            if action == "drop" && !doc.is_null() {
                emit(app, "document", doc.clone());
            }
            Ok(doc)
        }
        "memory" => {
            let mut doc: Document = serde_json::from_value(payload).map_err(|e| e.to_string())?;
            if doc.content.len() > files::MAX_DOCUMENT {
                return Err("Document exceeds 12 MB.".into());
            }
            if !confirm(&mut s, app, state)? {
                return Ok(Value::Null);
            }
            doc.path = None;
            doc.base_url = None;
            doc.revision = None;
            Ok(json!(adopt(&mut s, doc, &state.settings)))
        }
        "save" => save(&mut s, app, state, payload == true),
        "close" => {
            if confirm(&mut s, app, state)? {
                app.exit(0);
            }
            Ok(Value::Null)
        }
        "remote-images" => {
            s.remote = payload == true;
            Ok(json!(s.remote))
        }
        "embed" => {
            let source = text(&payload)?;
            if source.starts_with("https://") && s.remote {
                let mut response = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(25))
                    .build()
                    .map_err(|e| e.to_string())?
                    .get(source)
                    .send()
                    .and_then(|r| r.error_for_status())
                    .map_err(|e| e.to_string())?;
                let mime = response
                    .headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .split(';')
                    .next()
                    .unwrap_or("")
                    .to_string();
                if ![
                    "image/png",
                    "image/jpeg",
                    "image/gif",
                    "image/webp",
                    "image/svg+xml",
                    "image/avif",
                    "image/bmp",
                    "image/x-icon",
                ]
                .contains(&mime.as_str())
                {
                    return Err("The remote resource is not a supported image.".into());
                }
                use std::io::Read;
                let mut bytes = Vec::new();
                response
                    .by_ref()
                    .take(20 * 1024 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|e| e.to_string())?;
                if bytes.len() > 20 * 1024 * 1024 {
                    return Err("The image exceeds the 20 MB limit.".into());
                }
                return Ok(json!(format!(
                    "data:{mime};base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                )));
            }
            let (bytes, mime) = local_image(&s, source)?;
            Ok(json!(format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            )))
        }
        "link" => {
            let href = text(&payload["href"])?;
            if href.len() > 8192 {
                return Err("Link is too long.".into());
            }
            if href.starts_with("https://") || href.starts_with("http://") {
                let url = url::Url::parse(href).map_err(|e| e.to_string())?;
                if !url.username().is_empty() || url.password().is_some() {
                    return Err("Links containing credentials are blocked.".into());
                }
                open::that(url.as_str()).map_err(|e| e.to_string())?;
                return Ok(Value::Null);
            }
            let doc = s.doc.as_ref().ok_or("Open a document first")?;
            if payload["fromPath"] != json!(doc.path) {
                return Err("Link does not belong to the current document.".into());
            }
            let root = doc
                .path
                .as_ref()
                .and_then(|p| p.parent())
                .ok_or("Open the document from disk to follow local links")?;
            let href = href.split(['#', '?']).next().unwrap_or("");
            if href.is_empty() {
                return Ok(Value::Null);
            }
            let relative = percent_encoding::percent_decode_str(href)
                .decode_utf8()
                .map_err(|e| e.to_string())?;
            let relative = if Path::new(relative.as_ref()).extension().is_none() {
                format!("{relative}.md")
            } else {
                relative.into_owned()
            };
            let p = files::resolve(root, &relative)?;
            open_doc(&p, &mut s, app, state)
        }
        _ => Err("Unknown operation.".into()),
    }
}
#[tauri::command]
async fn request(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    action: String,
    payload: Value,
) -> Result<Value> {
    if window.label() != "main" {
        return Err("Request blocked.".into());
    }
    if action == "export" {
        return pdf::export(&app, &state, payload).await;
    }
    let state = state.inner().clone();
    let busy = !matches!(
        action.as_str(),
        "draft" | "recent" | "remote-images" | "embed" | "copy" | "copy-teams"
    );
    if busy {
        emit(&app, "busy", json!(true));
    }
    let handle = app.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || action_fn(&action, payload, &handle, &state))
            .await
            .map_err(|e| e.to_string());
    if busy {
        emit(&app, "busy", json!(false));
    }
    result?
}
fn action_fn(name: &str, payload: Value, app: &tauri::AppHandle, state: &State) -> Result<Value> {
    action(name, payload, app, state)
}

fn main() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("folio", |context, request| {
            let state = context.app_handle().state::<State>();
            let result = state
                .session
                .lock()
                .map_err(|_| "State unavailable".to_string())
                .and_then(|s| local_image(&s, &request.uri().to_string()));
            match result {
                Ok((bytes, mime)) => tauri::http::Response::builder()
                    .header("Content-Type", mime)
                    .header(
                        "Content-Security-Policy",
                        "default-src 'none'; style-src 'unsafe-inline'",
                    )
                    .header("Access-Control-Allow-Origin", "http://tauri.localhost")
                    .body(bytes)
                    .unwrap(),
                Err(_) => tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap(),
            }
        })
        .register_uri_scheme_protocol("folio-print", |context, _request| {
            let html = context
                .app_handle()
                .state::<State>()
                .print
                .lock()
                .unwrap()
                .clone();
            tauri::http::Response::builder()
                .header("Content-Type", "text/html; charset=utf-8")
                .header(
                    "Content-Security-Policy",
                    "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:",
                )
                .body(html.into_bytes())
                .unwrap()
        })
        .setup(|app| {
            let data_root = std::env::var_os("FOLIO_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_config_dir()?);
            files::local(&data_root).map_err(std::io::Error::other)?;
            let settings = data_root.join("recent.json");
            #[cfg(feature = "test-harness")]
            let settings = std::env::var("FOLIO_TEST_ROOT")
                .map(|p| PathBuf::from(p).join("recent.json"))
                .unwrap_or(settings);
            if !settings.exists()
                && std::env::var_os("FOLIO_DATA_DIR").is_none()
                && std::env::var_os("FOLIO_TEST_ROOT").is_none()
            {
                if let Some(roaming) = std::env::var_os("APPDATA") {
                    let legacy = PathBuf::from(roaming).join("Folio/recent.json");
                    if let Ok(bytes) = fs::read(legacy) {
                        if bytes.len() < 64 * 1024
                            && serde_json::from_slice::<Vec<Value>>(&bytes).is_ok()
                        {
                            if let Some(parent) = settings.parent() {
                                let _ = fs::create_dir_all(parent);
                            }
                            let _ = fs::write(&settings, bytes);
                        }
                    }
                }
            }
            let recent = fs::read(&settings)
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or_default();
            let state = State {
                session: Arc::new(Mutex::new(Session {
                    recent,
                    ..Default::default()
                })),
                print: Arc::new(Mutex::new(String::new())),
                settings,
            };
            app.manage(state.clone());
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_millis(900));
                let Ok(mut s) = state.session.try_lock() else {
                    continue;
                };
                let Some(doc) = s.doc.clone() else {
                    continue;
                };
                let Some(path) = &doc.path else {
                    continue;
                };
                if let Ok(updated) = files::read(path) {
                    if updated.revision != doc.revision {
                        if dirty(&s) {
                            if s.conflict != updated.revision {
                                s.conflict = updated.revision;
                                emit(&handle, "conflict", json!({"path":path}));
                            }
                        } else {
                            let new = adopt(&mut s, updated, &state.settings);
                            emit(&handle, "document", json!(new));
                        }
                    }
                }
            });
            let window =
                tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                    .data_directory(data_root.join("webview"))
                    .on_navigation(|url| {
                        matches!(
                            url.host_str(),
                            Some("tauri.localhost" | "localhost" | "127.0.0.1")
                        ) && matches!(url.scheme(), "http" | "https" | "tauri")
                    })
                    .build()?;
            use tauri::menu::{MenuBuilder, SubmenuBuilder};
            let file = SubmenuBuilder::new(app, "File")
                .text("new", "New document")
                .text("open", "Open document…")
                .separator()
                .text("save", "Save")
                .text("save-as", "Save As…")
                .separator()
                .text("export-html", "Export HTML…")
                .text("export-pdf", "Export PDF…")
                .text("export-teams", "Copy for Teams")
                .separator()
                .text("close", "Close")
                .build()?;
            let edit = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .separator()
                .text("find", "Find in document")
                .build()?;
            let view = SubmenuBuilder::new(app, "View")
                .text("read", "Read")
                .text("split", "Split")
                .text("source", "Source")
                .build()?;
            let help = SubmenuBuilder::new(app, "Help")
                .text("help", "Keyboard shortcuts and support")
                .build()?;
            window.set_menu(
                MenuBuilder::new(app)
                    .items(&[&file, &edit, &view, &help])
                    .build()?,
            )?;
            window.on_menu_event(|window, event| {
                emit(window.app_handle(), "command", json!(event.id().as_ref()))
            });
            let handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    emit(&handle, "command", json!("close"));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![request])
        .run(tauri::generate_context!())
        .expect("Folio could not start");
}
