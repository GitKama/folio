# Changelog

The original reader was developed on 16 September 2026. The public repository was prepared on 21 September 2026. Commit/tag dates reflect public release preparation, not invented historical Git activity.

## [1.3.0] — 2026-10-27

Copy the current Markdown draft into the Microsoft Teams message composer.

- Export → Copy for Teams and the matching native File menu command.
- HTML and plain-text clipboard representations through Electron's asynchronous ClipboardItem API; success is reported only after the write completes.
- Conservative rich formatting with labeled table rows, task markers, code/math/diagram source, expanded callouts, and image/link fallbacks.
- Current unsaved edits and selected dialect settings are included without saving, fetching assets or sending messages.
- Conversion notes in Document details and an 80 KB output budget with explicit errors rather than truncation.
- Unit, packaged IPC/UI, error-recovery and real Windows Teams draft-paste checks.
- Existing source/code clipboard writes now await completion and propagate failures.
- Documented a planned future Rust migration in ROADMAP.md; this release remains Electron.

## [1.2.0] — 2026-09-23

Designed PDF exports for meetings, reports and longer reading.

- Technical, Studio and Editorial profiles, with Technical selected initially.
- Saved export preferences, optional wide-table cards and meeting section layout.
- Export-only fonts, spacing, page numbers, running headers and light print colors.
- Repeated table headers, wrapping code, and flowing oversized content.
- Tagged PDFs and heading outlines through Chromium (not a PDF/UA certification).
- In-memory print document transport supports exports larger than a data URL.
- Synthetic meeting fixture, profile unit tests and real packaged PDF regression checks.

## [1.1.0] — 2026-09-21

Markdown editing in the existing Split and Source views.

- Live preview without resetting the caret or native undo history.
- Save, Save As, Ctrl+S, Ctrl+Shift+S, new documents and saveable pasted text.
- Unsaved-change indicators; Save/Discard/Cancel before closing or replacing a draft.
- Encoding/line-ending preservation, temporary-file saves and disk revision checks.
- External-change conflict handling; canceled or failed saves retain edits.
- Exports include the latest pending edit.
- Regression coverage for editor lifecycle, conflicts, failures and narrow layouts.

## [1.0.0] — 2026-09-21

Initial public release of the standalone Windows Markdown viewer.

- Read, Split and read-only Source; outline, search, recent documents, themes and live reload.
- Automatic, CommonMark, GitHub, Extended and Obsidian profiles.
- Tables, footnotes, callouts, front matter, code highlighting, math, Mermaid and Graphviz.
- Self-contained HTML/PDF exports.
- Sandboxed renderer, sanitized content and contained local file access.
- Windows portable executable, installer, application source and corresponding third-party source.
- Public packaging adds MIT licensing, supplemental notices and community documentation to the original app.

[1.0.0]: https://github.com/GitKama/folio/releases/tag/v1.0.0

[1.1.0]: https://github.com/GitKama/folio/releases/tag/v1.1.0

[1.2.0]: https://github.com/GitKama/folio/releases/tag/v1.2.0
