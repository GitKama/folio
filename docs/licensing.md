# Licensing and source availability

Folio's original application code, documentation and original icon are offered under [MIT](../LICENSE). Dependencies retain their licenses; Folio does not relicense them.

| Component | Version in 1.0 / 1.1 | License / notice |
| --- | --- | --- |
| Folio application | 1.0.0 / 1.1.0 | MIT |
| Electron | 44.4.1 | MIT plus Chromium/Node notices |
| Markdown-it, KaTeX, Mermaid, Highlight.js, YAML and extensions | package-lock.json | THIRD_PARTY_NOTICES.txt |
| DOMPurify | 3.4.15 | Apache-2.0 option of its dual license |
| Viz.js wrapper | 3.30.0 | MIT; licenses/Viz.js-MIT.txt |
| Graphviz inside Viz.js | 16.0.0 | EPL-2.0; licenses/Graphviz-EPL-2.0.txt |
| Expat inside Viz.js | 2.8.4 | MIT; licenses/Expat-MIT.txt |

The inventory includes development tools too; it does not claim every listed package is in the runtime. Electron's LICENSE.electron.txt and LICENSES.chromium.html remain inside the distribution. Folio's LICENSE, source-availability information and supplemental licenses are also packaged.

## Graphviz source

Each public release supplies **Folio-third-party-sources.zip**: unmodified Graphviz 16.0.0, Expat 2.8.4, and Viz.js source at commit `99da545270e6e7b127a5c7ba65974b8a604a6358`, including upstream licenses and the build recipe. Folio does not patch these components.

[licenses/upstream-sources.json](../licenses/upstream-sources.json) records the URLs and SHA-256 checksums. Viz.js's backend Dockerfile identifies the exact Graphviz and Expat releases and Emscripten toolchain. Source is supplied without a purchase or access request. The EPL-covered component remains EPL-covered; MIT applies to Folio's separate application code.

Primary sources: [MIT terms](https://choosealicense.com/licenses/mit/), [Graphviz license](https://graphviz.org/license/), [Viz.js license](https://github.com/mdaines/viz-js/blob/99da545270e6e7b127a5c7ba65974b8a604a6358/LICENSE), [Viz.js build recipe](https://github.com/mdaines/viz-js/blob/99da545270e6e7b127a5c7ba65974b8a604a6358/packages/viz/backend/Dockerfile).

## Electron and Chromium source

Electron 44.4.1 bundles Chromium 152.0.7977.78 and Node.js 24.21.0. Source: [Electron v44.4.1](https://github.com/electron/electron/tree/v44.4.1), [Chromium 152.0.7977.78](https://chromium.googlesource.com/chromium/src/+/152.0.7977.78), [Node.js v24.21.0](https://github.com/nodejs/node/tree/v24.21.0). Their manifests and distributed notices identify included components such as FFmpeg. Folio uses the upstream Electron distribution without patching it.

## Redistribution

Keep Folio's MIT notice, the package inventory, supplemental license files and Electron/Chromium notices with copies. Preserve source-availability information. Review new dependencies before release: a permissive top-level license does not replace dependency obligations.
