# Folio compatibility and verification

Folio is a local Markdown reader. Markdown has incompatible extensions, so broad support does not mean that every source application's behavior can be reproduced. This document records the implemented boundary and the checks used to verify it.

The desktop smoke suite writes its actual outcomes to `test-results/desktop-report.json`. The table below describes implemented behavior; the verification section records what was actually tested.

## Rendering profiles

**Auto** means a broad set of compatible extensions is enabled. It does not identify a document's original application or automatically choose between contradictory dialect conventions.

| Feature family | CommonMark | GitHub | Extended / Auto | Obsidian |
| --- | --- | --- | --- | --- |
| Headings, lists, quotations, links, fenced/indented code, safe HTML | Yes | Yes | Yes | Yes |
| Pipe tables, tasks, strikethrough, footnotes, emoji names | Literal extension syntax | Yes | Yes | Yes |
| GitHub alerts and Obsidian callouts | Ordinary quotation | Yes | Yes | Yes |
| YAML frontmatter metadata | Kept as source | Yes | Yes | Yes |
| Mathematics with KaTeX | Kept as source | Yes | Yes | Yes |
| Mermaid and Graphviz diagrams | Kept as code | Yes | Yes | Yes |
| Definitions, abbreviations, subscript, superscript, highlighting | Kept as source | Kept as source | Yes | Yes |
| `:::`, `!!!` and `???` admonitions | Kept as source | Kept as source | Yes | Yes |
| Wiki links, image embeds, block references | Kept as source | Kept as source | Yes | Yes |
| CriticMarkup and selected attribute syntax | Kept as source | Kept as source | Yes | Yes |

The GitHub profile supports useful GitHub-style extensions. It is not a claim of byte-for-byte reproduction of GitHub's website. Task checkboxes are a read-only representation. Syntax highlighting uses Highlight.js; formulas use KaTeX; diagram rendering is bundled locally and does not require a rendering service.

Safe raw HTML includes details/summary, tables and ordinary formatting. A small allowlist preserves static inline colors, alignment and bounded dimensions. Page-wide CSS, scripts, forms, frames, event handlers and styles that could position content over the application are removed; document classes and IDs are kept from colliding with application controls.

| Fixture | What it exercises |
| --- | --- |
| `samples/compatibility.md` | Frontmatter, core Markdown, GFM tables and tasks, footnotes, definitions, abbreviations, mathematics, code highlighting, Mermaid, Graphviz, callouts, wiki links, note embeds, local images, HTML sanitization, duplicate headings, and Unicode |
| `samples/Linked Note.md` | Links between local files and heading-specific note embeds |
| `samples/commonmark-edge-cases.md` | Escaping, nested code fences, ordered-list starts, loose lists, link forms, blockquotes, setext headings, entities, and raw HTML |
| `samples/unsupported-dialects.md` | MDX components and expressions, Quarto executable cells and references, MkDocs directives, unknown diagram languages, and malformed diagrams |

## Verification contract

Run `npm run test:desktop` from the source directory after dependencies and the production UI have been built. The runner opens only the Folio application, creates an isolated test profile, and closes its own application instance when done. It exercises the real packaged Chromium renderer and native export flows, then records screenshots and exported fixtures under `test-results/`.

Checks include document rendering, source and split views, dialect changes, search, themes, local-file navigation, image loading, outline targets, an alternate viewport size, standalone HTML export, PDF export, and Electron isolation settings. Hostile HTML in the fixture must never execute. A separate Chromium page verifies that an exported HTML document can render without the application UI or its preload bridge.

Verification performed on 2026-09-16:

- **30 automated parser and filesystem tests passed**, including uppercase HTML, cyclic YAML, malformed TeX, unsafe HTML/URLs/attributes, source CSS and UI isolation, shared footnotes in callouts, UTF-8/UTF-16/Windows-1252 files, asset traversal, and an actual Windows directory-junction escape attempt. No tests were skipped.
- **22 desktop integration checks passed against the production build**, including actual HTML/PDF export commands, native file input through the preload bridge, automatic file reload, local images and wiki navigation, source/profile/search/theme controls, and Electron isolation. Source and code Copy buttons were verified with a mocked native clipboard method; the user's actual clipboard was neither read nor changed. No uncaught renderer exceptions occurred.
- **Standalone HTML reopened successfully in an isolated Chromium context** with embedded local images, rendered diagrams and usable embedded KaTeX fonts. The export contained no scripts or relative math-font dependencies.
- **The exported five-page PDF passed text extraction and visual review of every page.** Headings, tables, code, formulas, both diagram types, callouts, local images, Unicode, and the final footnote were retained. Code contrast and callout footnote regressions found during visual review were corrected and retested.

These checks exercised the source application running its production bundle. Installer installation and the final distributed executable require their own packaging verification; a successful development runtime is not evidence that an installer has been installed.

## Deliberate boundaries

- Arbitrary JavaScript and JSX in MDX documents cannot run. Project components and imported code are not bundled into ordinary Markdown files.
- Quarto, R Markdown, Jupyter kernels, and executable code cells require their original runtimes. Displaying the source is not executing the analysis.
- MkDocs plugins, Docusaurus components, Hugo shortcodes, includes, citations, and other site-generator features may need the original site configuration or external data.
- Ambiguous Markdown conventions cannot always be inferred. A selected dialect profile and the compatibility notices are the reference for what Folio will interpret.
- Wiki links use the Obsidian `[[target|label]]` convention. Wiki note embeds appear as navigable links; recursive vault transclusion and full Obsidian vault resolution are not implemented.
- Relative documents and images must remain inside the opened document's folder. Links to a parent or sibling folder require opening the target explicitly. This protects unrelated local files but limits some repository and vault layouts.
- HTML-to-Markdown conversion is not implemented. Export creates a standalone reading copy, not a reversible source transformation.
- Standalone HTML embeds the current document's images, styles, math fonts and rendered diagrams. It does not bundle documents reached by links or recreate a vault/site around the exported page.
- A malformed diagram must produce a readable fallback or error, not break the rest of the document.
- Sanitization deliberately removes executable HTML. A faithful reproduction of unsafe active content is not a viewer compatibility goal.

## Size and resource boundaries

Markdown/text files are limited to 12 MB. Documents above two million characters receive a source preview and an explicit compatibility notice. Individual local images are limited to 20 MB. Expensive formula, highlighting and diagram inputs have additional bounds; the reader preserves source when a renderer's limit is reached. Graphviz layout runs in a worker with a timeout. Remote images are blocked by default and need the reader's explicit opt-in.

The file reader handles UTF-8, UTF-8 BOM and BOM-marked UTF-16 LE/BE. Invalid UTF-8 falls back to Windows-1252 for older Windows documents. That fallback is a practical assumption; it is not universal encoding detection.

These limits are deliberate guardrails for a desktop reader; they are not evidence of a formal security audit or full CommonMark conformance certification.
