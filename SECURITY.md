# Security policy

The latest published version is supported. Older versions are retained for reproducibility and may not receive fixes. There is no guaranteed response time or security certification.

## Reporting

Use GitHub's **Security → Report a vulnerability** for private reporting when available. If unavailable, open an issue asking for a private contact channel without publishing exploit details, private documents or credentials.

Include Folio/Windows versions, a minimal synthetic example, expected and actual behavior, and reproduction steps. Relevant areas include document execution, file-boundary escapes, unintended network requests and lost unsaved edits.

## Expected boundaries

Document scripts and executable cells are unsupported. HTML/SVG is sanitized, the renderer is sandboxed, and local resources are contained to the document folder. Remote images are opt-in; followed web links open the system browser. No telemetry or automatic updater is included.

Builds are unsigned. Download from this repository's Releases and compare checksums; checksums are not a publisher signature. Save work before forced shutdown or power loss.
