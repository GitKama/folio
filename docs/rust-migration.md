# Moving from Folio 1.x to 2.0

Folio 2.0 replaces Electron with Rust/Tauri and Windows WebView2. The reading/editor interface, Markdown dialects, math, diagrams and export functions remain available with a redesigned interface.

Save open documents and close Folio before upgrading. Keep a copy of the previous installer if rollback is needed. Install 2.0 in the desired Windows installation scope. Older 1.x installers used a different installation identity; if both versions remain listed in Windows Apps, remove the older version after verifying 2.0. Do not remove the legacy profile until any desired settings have been transferred.

The new configuration directory is `%APPDATA%\personal.folio.markdown`. It contains `recent.json`, `preferences.json` and WebView2 data. On first launch, 2.0 imports recent files from `%APPDATA%\Folio\recent.json` without modifying the original. Reading preferences start with 2.0 defaults unless imported into preferences.json. Documents are never moved or rewritten by installation.

For an isolated or portable profile, set `FOLIO_DATA_DIR` to an absolute local directory before launching. This also isolates recent documents and WebView2 storage. The portable executable still requires the system WebView2 runtime.

To roll back, close 2.0 and reinstall the desired 1.x release. Its original profile remains at `%APPDATA%\Folio`. Do not run two versions against an unsaved document simultaneously.
