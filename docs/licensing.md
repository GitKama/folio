# Licensing and source availability

Folio's original application code, documentation and original icon are MIT licensed. Dependencies retain their own licenses; the complete executable is not exclusively MIT software.

| Component | Version source | Notice |
| --- | --- | --- |
| Folio Rust host and interface | 2.0.0 | LICENSE |
| Tauri, Wry, Tao and Windows bindings | src-tauri/Cargo.lock | THIRD_PARTY_NOTICES.txt |
| Markdown-it, DOMPurify, KaTeX, Mermaid, Highlight.js, YAML and extensions | package-lock.json | THIRD_PARTY_NOTICES.txt |
| Viz.js wrapper | 3.30.0 | licenses/Viz.js-MIT.txt |
| Graphviz inside Viz.js | 16.0.0 | EPL-2.0; licenses/Graphviz-EPL-2.0.txt |
| Expat inside Viz.js | 2.8.4 | MIT; licenses/Expat-MIT.txt |

The notices inventory includes build tools as well as runtime dependencies. Microsoft Edge WebView2 is installed and licensed separately by Microsoft. Folio does not redistribute Electron or a Chromium runtime in 2.0.

## Corresponding source

Each release supplies Folio-third-party-sources.zip with unmodified Graphviz 16.0.0, Expat 2.8.4 and Viz.js at commit 99da545270e6e7b127a5c7ba65974b8a604a6358, including upstream licenses and the build recipe. Folio does not patch these components. licenses/upstream-sources.json records exact URLs and SHA-256 checksums. The EPL-covered component remains EPL-covered.

The Folio source archive includes Cargo.lock, package-lock.json and build scripts. Crates identify their upstream repositories in the notices inventory. Keep the MIT notice, dependency inventory, supplemental licenses and source-availability information with redistributed copies.
