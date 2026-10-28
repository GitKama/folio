# Architecture

Folio 2 uses a Rust/Tauri desktop host and Windows WebView2. The system webview displays a bundled Vite application. No Electron, Node runtime or bundled Chromium distribution is shipped. The document renderer remains JavaScript; this is a Rust desktop migration, not a rewrite of every parser in Rust.

| Responsibility | Implementation |
| --- | --- |
| Window, native menus, IPC, document lifecycle | src-tauri/src/main.rs |
| Encodings, revisions, atomic saves, contained paths | src-tauri/src/files.rs |
| Native dialogs; separately compiled test substitutes | src-tauri/src/dialogs.rs |
| Isolated PDF renderer and export files | src-tauri/src/pdf.rs |
| Ordered frontend/native bridge | src/native.js |
| Reader/editor interface | src/app.js, src/style.css |
| Markdown dialects and sanitization | src/engine.js |
| Mermaid and Graphviz worker | src/diagrams.js, src/graphviz.worker.js |
| HTML/PDF snapshots and profile transformations | src/export.js, src/pdf-profiles.js, src/pdf.css |
| Teams semantic HTML and plain text | src/teams-export.js |

## Trust boundary

Only the main bundled webview receives the application request capability. It has no general filesystem, shell or window-creation plugin. Navigation is constrained. Document scripts, frames and interactive application controls are removed; local assets are resolved against the current document folder with canonical-path checks. Per-document asset URLs avoid stale image caching. Remote images require opt-in. HTTP(S) links open externally only after a click.

## Document lifecycle

The frontend serializes native requests so a pending draft reaches Rust before a save. Rust owns the saved baseline, encoding and SHA-256 disk revision. Saves write and flush a same-directory temporary file, check the expected revision, then atomically replace the destination. Unchanged mixed line endings and BOMs survive round trips. Unrepresentable Windows-1252 edits require Save As to UTF-8.

A 900ms application-owned polling loop reloads clean documents and flags conflicts for dirty documents. It stops with the application; there is no background service. Native close asks the frontend to flush the latest draft, then Rust presents Save/Discard/Cancel. This is optimistic conflict detection, not collaborative locking or crash recovery.

## Clipboard and export

Teams uses Windows CF_HTML and CF_UNICODETEXT under one clipboard lock. The converter preserves readable fallbacks and rejects oversized output. No Teams API, login or message-sending capability exists.

PDF exports render a self-contained snapshot in a hidden WebView2 with no application capabilities and a restrictive CSP. Native DevTools protocol calls await fonts/images and generate the PDF with A4 pagination, profile styles, headers and footers. The temporary renderer is destroyed afterward. HTML and PDF are fully generated before replacing an existing export.

## Settings and testing

Rust stores recent files and preferences under the app configuration directory. WebView2 also retains the interface preferences locally. Existing Electron recent files are imported on first launch; the old profile is not modified. Reading preferences from 1.x may be imported as preferences.json; otherwise 2.0 starts with its defaults.

The test-harness Cargo feature substitutes dialog choices and allows synthetic clipboard inspection. It requires an isolated test root. Production packages omit this feature; the production smoke check verifies that test commands are unavailable. Unit tests exercise parsing, conversion, encoding and conflict safety. Native integration checks drive the actual WebView2 app and filesystem.
