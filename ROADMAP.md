# Roadmap

## Completed in 2.0: Rust desktop migration

Folio now uses Rust and Tauri with Windows WebView2. Electron has been removed. The new document workbench retains reading and source editing, Markdown profiles, math, diagrams, safe saves, HTML/PDF export and Teams clipboard conversion. JavaScript remains responsible for the bundled document-rendering engine.

## Possible follow-ups

- Additional client-by-client Teams paste validation, without claiming universal formatting parity.
- Signed Windows releases when a signing identity is available.
- Evaluate other desktop platforms after the Windows implementation is established.

These are directions, not scheduled commitments. No automatic updater, document sync or cloud account is included.
