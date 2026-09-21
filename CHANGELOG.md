# Changelog

The original reader was developed on 16 September 2026. The public repository was prepared on 21 September 2026. Commit/tag dates reflect public release preparation, not invented historical Git activity.

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
