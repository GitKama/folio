use super::*;
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use windows::core::HSTRING;

async fn cdp(window: &tauri::WebviewWindow, method: &str, params: Value) -> Result<Value> {
    let (tx, rx) = std::sync::mpsc::channel();
    let method = method.to_string();
    let params = params.to_string();
    window
        .with_webview(move |view| unsafe {
            let fail = tx.clone();
            let callback = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |status, result| {
                    let response = status
                        .map_err(|e| e.to_string())
                        .and_then(|_| serde_json::from_str(&result).map_err(|e| e.to_string()));
                    let _ = tx.send(response);
                    Ok(())
                },
            ));
            let result = view.controller().CoreWebView2().and_then(|core| {
                core.CallDevToolsProtocolMethod(
                    &HSTRING::from(method),
                    &HSTRING::from(params),
                    &callback,
                )
            });
            if let Err(e) = result {
                let _ = fail.send(Err(e.to_string()));
            }
        })
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(60))
            .map_err(|_| "PDF renderer timed out.".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}
fn safe_title(title: &str) -> String {
    title
        .chars()
        .take(120)
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect()
}
fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub async fn export(app: &tauri::AppHandle, state: &State, payload: Value) -> Result<Value> {
    let format = text(&payload["format"])?;
    if !["pdf", "html"].contains(&format) {
        return Err("Unsupported export format.".into());
    }
    let html = text(&payload["html"])?;
    if html.len() > 90 * 1024 * 1024 || !html.contains("<head>") {
        return Err("Invalid or oversized export.".into());
    }
    let title = payload["title"].as_str().unwrap_or("Document");
    let filename = format!("{}.{}", safe_title(title).trim_end_matches(".md"), format);
    let ext = format.to_string();
    let path = tauri::async_runtime::spawn_blocking(move || dialogs::export_file(&filename, &ext))
        .await
        .map_err(|e| e.to_string())?;
    let Some(path) = path else {
        return Ok(json!({"canceled":true}));
    };
    files::local(&path)?;
    if path.extension().and_then(|s| s.to_str()) != Some(format) {
        return Err(format!("Choose a .{format} filename."));
    }
    let locked=html.replacen("<head>","<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'\">",1);
    let bytes = if format == "html" {
        locked.into_bytes()
    } else {
        if app.get_webview_window("print").is_some() {
            return Err("Another PDF export is still running.".into());
        }
        *state.print.lock().map_err(|_| "PDF state unavailable")? = locked;
        let (tx, rx) = std::sync::mpsc::channel();
        let window = tauri::WebviewWindowBuilder::new(
            app,
            "print",
            tauri::WebviewUrl::CustomProtocol(
                "http://folio-print.localhost/document".parse().unwrap(),
            ),
        )
        .visible(false)
        .inner_size(1000.0, 900.0)
        .skip_taskbar(true)
        .on_navigation(|url| url.host_str() == Some("folio-print.localhost"))
        .on_page_load(move |_, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let _ = tx.send(());
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
        let result=async {
            tauri::async_runtime::spawn_blocking(move||rx.recv_timeout(Duration::from_secs(30))).await.map_err(|e|e.to_string())?.map_err(|_|"PDF page did not load")?;
            cdp(&window,"Runtime.evaluate",json!({"expression":"Promise.all([document.fonts.ready,...Array.from(document.images,i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r}))]).then(()=>{document.querySelectorAll('.pdf-card,tr,.diagram').forEach(e=>{if(e.getBoundingClientRect().height>945)e.style.breakInside='auto'});return true})","awaitPromise":true})).await?;
            let label=match payload["pdfProfile"].as_str(){Some("studio")=>"Studio",Some("editorial")=>"Editorial",_=>"Technical"};
            let style="width:100%;margin:0 17mm;font:9px Arial,sans-serif;color:#58667c;display:flex;justify-content:space-between;gap:12px";
            let pdf=cdp(&window,"Page.printToPDF",json!({"printBackground":true,"preferCSSPageSize":true,"paperWidth":8.2677,"paperHeight":11.6929,"marginTop":0.75,"marginBottom":0.79,"marginLeft":0.67,"marginRight":0.67,"generateDocumentOutline":true,"generateTaggedPDF":true,"displayHeaderFooter":true,"headerTemplate":format!("<div style=\"{style};border-bottom:1px solid #dce1ed;padding-bottom:6px\"><span>FOLIO / {label}</span><span>{}</span></div>",escape(title)),"footerTemplate":format!("<div style=\"{style};border-top:1px solid #dce1ed;padding-top:6px\"><span>Folio</span><span><span class=\"pageNumber\"></span> / <span class=\"totalPages\"></span></span></div>")})).await?;
            base64::engine::general_purpose::STANDARD.decode(text(&pdf["data"])?).map_err(|e|e.to_string())
        }.await;
        let _ = window.destroy();
        state.print.lock().unwrap().clear();
        result?
    };
    use std::io::Write;
    let mut temp =
        tempfile::NamedTempFile::new_in(path.parent().ok_or("Missing destination folder")?)
            .map_err(|e| e.to_string())?;
    temp.write_all(&bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    temp.persist(&path).map_err(|e| e.to_string())?;
    Ok(json!({"path":path}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn titles_cannot_add_markup_or_path_separators() {
        assert_eq!(
            escape("<img src='x'>&\""),
            "&lt;img src=&#39;x&#39;&gt;&amp;&quot;"
        );
        assert_eq!(safe_title("report/../../x:bad?"), "report-..-..-x-bad-");
        assert_eq!(safe_title(&"x".repeat(500)).len(), 120);
    }
}
