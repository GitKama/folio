# Using Folio

## Install or launch

Download a Windows x64 build from [Releases](https://github.com/GitKama/folio/releases). The portable EXE runs without installation; the installer provides a per-user installation and shortcuts. Builds are unsigned. No account or separate rendering tools are needed. Close the old app before switching versions.

## Open and read

Use Ctrl+O, Open document, drag and drop, or Paste Markdown. Read shows the rendered document. Split places source beside the preview. Source displays the original Markdown. In 1.1, Split and Source are editable; version 1.0 is read-only.

The outline navigates headings. Ctrl+F searches rendered text; Enter/Shift+Enter move between matches. Esc closes panels. The Format selector changes interpretation without changing the file. Preferences and recent paths stay in the local application profile.

## Edit and save (1.1)

Type in Split or Source. Split updates after a short pause. Ctrl+N starts a new document; Ctrl+Z/Ctrl+Y undo and redo text edits. A dot in the title and an Unsaved changes label show pending work.

Use Ctrl+S or the toolbar Save icon. Ctrl+Shift+S, File → Save As, or the source footer saves a copy and makes it the active document. New and pasted documents can be saved to real Markdown files.

Closing or switching documents offers Save, Discard and Cancel. Canceling or failing a save keeps the draft open. If a file changes externally while you edit, Folio retains your draft; Save offers a copy, replacement of the disk version, or Cancel.

Normal Save preserves supported UTF-8/UTF-16/Windows-1252 encoding and the original line-ending convention. Save As creates UTF-8. Characters unavailable in Windows-1252 require a UTF-8 copy. Moving a copy to another folder does not relocate images or rewrite relative links.

Edits are not autosaved. Normal close prompts do not protect against crashes, forced termination or power loss.

## Export

Choose Export → Standalone HTML or PDF. Ctrl+P starts PDF export. HTML bundles styles, math fonts, images and rendered diagrams. Missing images stop export with an explanation. Relative document links remain links; exporting does not bundle a whole vault or website.

PDF opens a style dialog. Technical is the initial choice; Studio suits everyday reports and Editorial suits longer prose. Adjust wide-table cards and meeting section layout, then choose Save PDF. Folio remembers your choices. Export includes unsaved edits without saving or rewriting the Markdown. See the [PDF guide](pdf-export.md).

## Local files and images

Images and local Markdown links are resolved relative to the current file, within that folder and its descendants. Use Open for a file outside the folder. Network share paths are not supported. HTTPS images are off by default; enable them in Reading settings if needed.

Unmodified files reload after another editor saves them. See [COMPATIBILITY.md](../COMPATIBILITY.md) for size limits, supported syntax, and runtime-dependent formats.

## Updates and troubleshooting

Download releases manually. Keep your documents separately from the app directory. If rendering differs from another application, try its matching Format and inspect Document details. For a bug report, supply a small synthetic example instead of a private document.

Use PowerShell's Get-FileHash with -Algorithm SHA256 to compare a download with the release's SHA256SUMS.txt.
