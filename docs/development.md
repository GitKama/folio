# Development

Use Windows x64, Node.js 22.22 or newer, Rust stable (MSVC, at least 1.90), Visual Studio C++ Build Tools with a Windows SDK, and Microsoft Edge WebView2. Install locked dependencies with npm ci. Folio is private in package.json only to prevent accidental npm publication; its source remains MIT.

| Command | Purpose |
| --- | --- |
| npm start | Tauri development window with Vite |
| npm run dev | Browser-only frontend preview |
| npm test | Markdown, security, PDF-profile and Teams converter regressions |
| npm run test:rust | Rust filesystem/encoding tests |
| npm run test:native-build | Build an isolated native test executable |
| npm run test:desktop | Real WebView2 integration suite |
| npm run package | Build production Rust EXE and NSIS installer |
| node tests/production-smoke.cjs | Verify the production executable and absent test hooks |
| node scripts/collect-licenses.mjs | Regenerate JavaScript and Rust dependency notices |
| npm run release:assemble | Assemble tagged release assets and checksums |

The desktop suite writes synthetic fixtures and profiles under test-results/native. It substitutes dialog responses through a compile-time test feature; native saves, clipboard writes and PDF rendering remain real. Do not publish binaries built with test-harness. cargo build alone uses the development URL; use --features custom-protocol for an embedded frontend, or let the Tauri build CLI select it.

Production binaries are in src-tauri/target/release; the installer is in bundle/nsis beneath it. The portable EXE embeds the frontend and requires WebView2 already installed. The installer can obtain Microsoft's WebView2 bootstrapper when required. Neither format bundles Electron.

The Windows CI has read-only repository permissions, runs both test layers, builds production artifacts and verifies the final runtime. It does not publish. Keep Cargo.lock and package-lock.json committed. Dependabot checks npm, Cargo and workflow dependencies. Update notices and corresponding-source archives when changing Viz.js/Graphviz.

For isolated verification or a portable profile, set FOLIO_DATA_DIR to an absolute local folder. Both recent files/preferences and WebView2 data stay there. Omit it for the normal Windows profile.
