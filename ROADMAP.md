# Roadmap

## Future Rust migration

Folio is currently an Electron application. A migration to Rust is planned for a future project, as requested by the maintainer on 27 October 2026. It is not part of the 1.3 Teams clipboard release, and no migration schedule or replacement UI framework has been selected.

The migration should preserve the existing reading and editing workflow, Markdown compatibility, safe file saving, HTML/PDF exports, and Teams clipboard behavior. Reuse the synthetic fixtures and acceptance checks to compare implementations before replacing the shipped app. Packaging, settings compatibility and upgrade behavior need explicit validation.

Until that work is scoped and verified, the maintained application and releases continue to use Electron.
