# Development

Use Windows x64, Node.js 22.22 or newer, npm, and Git. Run `npm ci` using the lockfile. If your environment disables dependency install scripts, run `node node_modules/electron/install.js` after reviewing that standard Electron installer.

The npm package is marked private only to prevent accidental npm publication; Folio's application source is MIT open source.

| Command | Purpose |
| --- | --- |
| npm run dev | Vite browser preview; native features require Electron |
| npm run build | Compile the renderer into dist/ |
| npm start | Launch the desktop app using the built renderer |
| npm test | Renderer and filesystem regressions |
| npm run test:desktop | Actual Electron viewer checks |
| npm run package | Windows portable EXE and NSIS installer |
| npm run release:assemble | Gather verified artifacts and source archive |

Build before running desktop tests. Tests use synthetic documents and isolated profiles under test-results/. Native dialog answers and clipboard writes are substituted; the renderer, IPC and filesystem still run. FOLIO_TEST_MODE=1 is reserved for test processes.

## Packaged verification

```powershell
npm test
npm run package
$env:FOLIO_TEST_EXECUTABLE = (Resolve-Path release/win-unpacked/Folio.exe).Path
$env:FOLIO_TEST_RESULTS_DIR = Join-Path (Get-Location) 'test-results/packaged'
npm run test:desktop
node tests/portable-smoke.cjs
npm run release:assemble
```

Release staging goes to release-assets/ and is ignored by Git. Assembly requires passing integration reports and produces SHA-256 checksums.

## CI and dependencies

The Windows workflow installs locked dependencies, tests, builds and verifies a packaged directory. It has read-only repository permissions, uploads diagnostic reports and does not publish releases. Actions are pinned to commit SHAs. Dependabot checks npm and workflow dependencies monthly; updates need review.

When upgrading Viz.js/Graphviz, update source availability, license files and release source bundles together. Preserve supplemental notices in licenses/. See [licensing](licensing.md).
