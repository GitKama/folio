# Folio

## Platform
Windows desktop application. The document interface uses web technologies inside a native Rust host.

## Purpose
Read, edit and share local Markdown without an account or a hosted service. Alex requested a Rust rebuild, a new UI, a GitHub release and an upgrade of his installed Windows copy, with creative decisions delegated.

## Workflows and constraints
Open or paste Markdown; navigate the outline; read, edit source or compare both; save safely; export self-contained HTML, styled PDF or Teams clipboard content. Preserve CommonMark, GitHub, extended and Obsidian profiles, math and diagrams. Documents stay local. Remote images require opt-in. Preserve unsaved edits and detect external file changes.

## Stack
Rust with Tauri and the Windows WebView2 runtime. Bundled Markdown rendering libraries remain JavaScript; Electron and its bundled Chromium runtime are removed. No authentication, analytics or cloud dependency.

## Voice and accessibility
Plain, direct action labels. Keyboard-accessible controls, visible focus, readable contrast, light and dark themes. No invented product claims or performance figures.
