# Using Folio

## Install or launch

Download a Windows x64 build from [Releases](https://github.com/GitKama/folio/releases). The portable EXE runs without installation; the installer provides a per-user installation and shortcuts. Builds are unsigned. No account or separate rendering tools are needed. Close the old app before switching versions.

## Open and read

Use Ctrl+O, Open document, drag and drop, or Paste Markdown. Read shows the rendered document. Split places source beside the preview. Source displays the original Markdown. In version 1.0, source is read-only.

The outline navigates headings. Ctrl+F searches rendered text; Enter/Shift+Enter move between matches. Esc closes panels. The Format selector changes interpretation without changing the file. Preferences and recent paths stay in the local application profile.

## Export

Choose Export → Standalone HTML or PDF. Ctrl+P starts PDF export. HTML bundles styles, math fonts, images and rendered diagrams. Missing images stop export with an explanation. Relative document links remain links; exporting does not bundle a whole vault or website.

## Local files and images

Images and local Markdown links are resolved relative to the current file, within that folder and its descendants. Use Open for a file outside the folder. Network share paths are not supported. HTTPS images are off by default; enable them in Reading settings if needed.

Unmodified files reload after another editor saves them. See [COMPATIBILITY.md](../COMPATIBILITY.md) for size limits, supported syntax, and runtime-dependent formats.

## Updates and troubleshooting

Download releases manually. Keep your documents separately from the app directory. If rendering differs from another application, try its matching Format and inspect Document details. For a bug report, supply a small synthetic example instead of a private document.

Use PowerShell's Get-FileHash with -Algorithm SHA256 to compare a download with the release's SHA256SUMS.txt.
