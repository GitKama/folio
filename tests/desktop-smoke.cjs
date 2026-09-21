/* Real Electron checks. No external browser or user profile is controlled. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const results = path.resolve(process.env.FOLIO_TEST_RESULTS_DIR || path.join(appRoot, 'test-results'));
const fixture = path.join(appRoot, 'samples', 'compatibility.md');
const htmlPath = path.join(results, 'compatibility-export.html');
const pdfPath = path.join(results, 'compatibility-export.pdf');
const executablePath = process.env.FOLIO_TEST_EXECUTABLE || path.join(appRoot, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const report = { startedAt: new Date().toISOString(), executablePath, fixture, checks: [], pageErrors: [], consoleErrors: [], artifacts: {} };
let electronApp;
let page;

async function check(name, action, fatal = false) {
  const started = Date.now();
  console.log(`RUN  ${name}`);
  try {
    const details = await action();
    report.checks.push({ name, status: 'passed', durationMs: Date.now() - started, ...(details === undefined ? {} : { details }) });
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    report.checks.push({ name, status: 'failed', durationMs: Date.now() - started, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
    if (fatal) throw error;
    return false;
  }
}

async function waitForFile(filePath, minSize = 100, timeout = 45000, notBefore = 0) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat && stat.size >= minSize && stat.mtimeMs >= notBefore) return stat;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Expected output was not written: ${path.basename(filePath)}`);
}

async function openFixture(filePath) {
  await electronApp.evaluate(async (_electron, candidate) => globalThis.__FOLIO_TEST__.openFile(candidate), filePath);
}

async function documentReady(title = 'Folio compatibility atlas') {
  await page.locator('#document-content h1').filter({ hasText: title }).first().waitFor({ state: 'visible', timeout: 30000 });
}

async function exportViaUi(format, filePath) {
  await electronApp.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, filePath);
  if (!(await page.getByRole('button', { name: `Export ${format}`, exact: true }).isVisible())) await page.locator('#export-toggle').click();
  const started = Date.now();
  await page.getByRole('button', { name: `Export ${format}`, exact: true }).click();
  try { return await waitForFile(filePath, format === 'PDF' ? 5000 : 1000, 45000, started - 1); }
  catch (error) {
    const message = await page.locator('#toast').textContent().catch(() => 'No toast available');
    const status = await page.locator('#status-message').textContent().catch(() => 'No status available');
    throw new Error(`${error.message}. UI: ${message}; status: ${status}`);
  }
}

(async () => {
  await fs.mkdir(results, { recursive: true });
  const profile = path.join(results, `profile-${Date.now()}`);
  const launchEnv = { ...process.env, FOLIO_TEST_MODE: '1', FOLIO_TEST_FILE: fixture, FOLIO_TEST_USER_DATA: profile };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  try {
    electronApp = await electron.launch({ executablePath, args: process.env.FOLIO_TEST_EXECUTABLE ? [] : [appRoot], cwd: appRoot, env: launchEnv, timeout: 45000 });
    page = await electronApp.firstWindow({ timeout: 30000 });
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    await check('Production application opens the initial local fixture', async () => {
      await documentReady();
      assert.match(await page.title(), /Folio/i);
      return { title: await page.title() };
    }, true);

    await check('Chromium and preload security boundaries are enabled', async () => {
      const security = await electronApp.evaluate(() => globalThis.__FOLIO_TEST__.getSecurity());
      assert.equal(security.contextIsolation, true);
      assert.equal(security.nodeIntegration, false);
      assert.equal(security.sandbox, true);
      assert.notEqual(security.webSecurity, false);
      const globals = await page.evaluate(() => ({ require: typeof require, process: typeof process, bridge: typeof window.folio }));
      assert.deepEqual(globals, { require: 'undefined', process: 'undefined', bridge: 'object' });
      return security;
    });

    await check('Renderer bridge refuses unauthorized links and asset capabilities', async () => {
      const denied = await page.evaluate(async () => {
        const doc = await window.folio.getInitialDocument();
        const requests = [
          () => window.folio.openLink({ href: 'javascript:alert(1)', fromPath: doc.path }),
          () => window.folio.openLink({ href: 'file:///C:/folio-forbidden.md', fromPath: doc.path }),
          () => window.folio.openLink({ href: '%5c%5cfolio-invalid-host.invalid%5cshare%5cnote.md', fromPath: doc.path }),
          () => window.folio.embedResource('folio://asset-00000000000000000000000000000000/private.png'),
          () => window.folio.embedResource(`${doc.baseUrl}..%5c..%5cpackage.json`)
        ];
        return Promise.all(requests.map(async (request) => { try { await request(); return false; } catch { return true; } }));
      });
      assert.deepEqual(denied, [true, true, true, true, true]);
      return { deniedRequests: denied.length };
    });

    await check('Core Markdown, GFM tables, tasks and notes render', async () => {
      const article = page.locator('#document-content');
      assert.equal(await article.locator('table').count(), 1);
      assert.equal(await article.locator('table tbody tr').count(), 3);
      assert.equal(await article.locator('input[type="checkbox"]').count(), 3);
      assert.equal(await article.locator('input[type="checkbox"]:checked').count(), 1);
      assert.ok(await article.locator('del, s').count() >= 1);
      assert.ok(await article.locator('dl').count() >= 1);
      assert.ok(await article.locator('.footnote-ref, a[href^="#fn"]').count() >= 1);
      assert.equal(await article.locator('.footnotes').count(), 1);
      assert.equal(await article.locator('.callout .footnotes,.admonition .footnotes').count(), 0);
      assert.ok(await article.locator('pre code').count() >= 3);
      assert.match(await article.innerText(), /Καλημέρα.*日本語.*مرحبا/s);
      return { headings: await article.locator('h1,h2,h3,h4,h5,h6').count() };
    });

    await check('Source views preserve the original and dialect profiles change interpretation', async () => {
      await page.getByRole('button', { name: 'Split', exact: true }).click();
      await page.locator('#source-pane').waitFor({ state: 'visible' });
      assert.match(await page.locator('#source-content').inputValue(), /\[\[Linked Note\|the companion note\]\]/);
      assert.equal(await page.locator('#source-content').getAttribute('readonly'), '');
      await page.getByRole('button', { name: 'Source', exact: true }).click();
      assert.equal(await page.locator('#document-content').isVisible(), false);
      await page.getByRole('button', { name: 'Read', exact: true }).click();
      await page.locator('#profile-select').selectOption('commonmark');
      await page.waitForFunction(() => document.querySelectorAll('#document-content table').length === 0);
      assert.equal(await page.locator('#document-content .katex').count(), 0);
      assert.match(await page.locator('#document-content').innerText(), /\[\[Linked Note\]\]/);
      await page.locator('#profile-select').selectOption('auto');
      await page.locator('#document-content table').waitFor();
      return { profiles: ['commonmark', 'auto'], views: ['split', 'source', 'read'] };
    });

    await check('Source and code Copy buttons use the native bridge without broad clipboard permission', async () => {
      // Intercept only this test application's main-process method. Never read or
      // write the user's actual operating-system clipboard during verification.
      await electronApp.evaluate(({ clipboard }) => {
        globalThis.__FOLIO_CLIPBOARD_TEST__ = [];
        clipboard.writeText = (value) => { globalThis.__FOLIO_CLIPBOARD_TEST__.push(value); };
      });
      await page.getByRole('button', { name: 'Split', exact: true }).click();
      await page.locator('#copy-source').click();
      await page.locator('#toast').filter({ hasText: 'Markdown copied to clipboard.' }).waitFor();
      await page.getByRole('button', { name: 'Read', exact: true }).click();
      const code = await page.locator('#document-content .code-block pre code').first().textContent();
      await page.locator('#document-content .code-copy').first().click();
      await page.locator('#toast').filter({ hasText: 'Code copied to clipboard.' }).waitFor();
      const captured = await electronApp.evaluate(() => globalThis.__FOLIO_CLIPBOARD_TEST__);
      assert.equal(captured.length, 2);
      assert.equal(captured[0], await fs.readFile(fixture, 'utf8'));
      assert.equal(captured[1], code);
      return { nativeCalls: captured.length, osClipboardTouched: false };
    });

    await check('Mathematics and both diagram engines render locally', async () => {
      await page.locator('#document-content .katex-display').first().waitFor();
      await page.locator('#document-content .mermaid svg').first().waitFor({ timeout: 45000 });
      await page.locator('#document-content .graphviz svg').first().waitFor({ timeout: 45000 });
      assert.ok(await page.locator('#document-content .katex').count() >= 3);
      assert.ok(await page.locator('#document-content .mermaid svg text').count() >= 3);
      assert.ok(await page.locator('#document-content .graphviz svg text').count() >= 3);
      return { math: await page.locator('#document-content .katex').count(), mermaid: await page.locator('#document-content .mermaid svg').count(), graphviz: await page.locator('#document-content .graphviz svg').count() };
    });

    await check('Callouts and local SVG, PNG and wiki-image embeds render', async () => {
      assert.ok(await page.locator('#document-content .callout').count() >= 2);
      for (const alt of ['Local SVG illustration', 'Local PNG pixel']) {
        await page.locator(`#document-content img[alt="${alt}"]`).scrollIntoViewIfNeeded();
        await page.waitForFunction((value) => {
          const img = Array.from(document.querySelectorAll('#document-content img')).find((item) => item.alt === value);
          return Boolean(img && img.complete && img.naturalWidth > 0);
        }, alt, { timeout: 15000 });
      }
      const wiki = page.locator('#document-content img.wiki-embed');
      assert.ok(await wiki.count() >= 1);
      await wiki.first().scrollIntoViewIfNeeded();
      await wiki.first().evaluate((img) => img.decode());
      return { localImageCount: await page.locator('#document-content img').count() };
    });

    await check('Hostile HTML remains inert and executable attributes are stripped', async () => {
      const actual = await page.locator('#document-content').evaluate((article) => ({
        executed: window.__folioXss,
        scripts: article.querySelectorAll('script,iframe,object,embed').length,
        events: Array.from(article.querySelectorAll('*')).flatMap((el) => Array.from(el.attributes)).filter((attr) => /^on/i.test(attr.name)).map((attr) => attr.name),
        javascriptUrls: Array.from(article.querySelectorAll('[href],[src]')).filter((el) => /^\s*javascript:/i.test(el.getAttribute('href') || el.getAttribute('src') || '')).length
      }));
      assert.equal(actual.executed, undefined);
      assert.equal(actual.scripts, 0);
      assert.equal(actual.javascriptUrls, 0);
      assert.deepEqual(actual.events, []);
      return { activeElements: actual.scripts, eventAttributes: actual.events.length, unsafeUrls: actual.javascriptUrls };
    });

    await check('Outline targets exist and duplicate headings have unique IDs', async () => {
      const ids = await page.locator('#document-content h1,#document-content h2,#document-content h3').evaluateAll((headings) => headings.map((heading) => heading.id));
      assert.ok(ids.every(Boolean));
      assert.equal(new Set(ids).size, ids.length);
      const duplicateIds = await page.locator('#document-content h2').filter({ hasText: /^Duplicate heading$/ }).evaluateAll((headings) => headings.map((heading) => heading.id));
      assert.equal(duplicateIds.length, 2);
      assert.notEqual(duplicateIds[0], duplicateIds[1]);
      assert.ok(await page.locator('#outline a, #outline button').count() >= 10);
      return { headingCount: ids.length, duplicateIds };
    });

    await check('Find highlights matches and a theme change preserves readable content', async () => {
      await page.getByRole('button', { name: 'Find in document', exact: true }).click();
      await page.locator('#search-input').fill('Markdown');
      await page.locator('#document-content mark.folio-search-match').first().waitFor();
      assert.match(await page.locator('#search-count').innerText(), /\d+\s*\/\s*\d+/);
      await page.getByRole('button', { name: 'Close search', exact: true }).click();
      assert.equal(await page.locator('#document-content mark.folio-search-match').count(), 0);
      const initial = await page.locator('html').getAttribute('data-theme');
      await page.locator('#theme-toggle').click();
      assert.notEqual(await page.locator('html').getAttribute('data-theme'), initial);
      await page.locator('#theme-toggle').click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), initial);
    });

    await check('Standalone HTML exports through the actual UI', async () => {
      const stat = await exportViaUi('HTML', htmlPath);
      const html = await fs.readFile(htmlPath, 'utf8');
      assert.match(html, /<!doctype html>/i);
      assert.match(html, /Folio compatibility atlas/);
      assert.match(html, /data:image\/svg\+xml[;,]/i);
      assert.match(html, /<svg\b/i);
      assert.doesNotMatch(html, /<script\b/i);
      assert.doesNotMatch(html, /<iframe\b/i);
      assert.doesNotMatch(html, /url\(["']?(?:\.\/)?fonts\//i);
      report.artifacts.html = htmlPath;
      return { bytes: stat.size };
    });

    await check('Exported HTML reopens independently with images and diagrams', async () => {
      const opened = electronApp.waitForEvent('window', { timeout: 15000 });
      await electronApp.evaluate(async ({ BrowserWindow }, target) => {
        const exportPreview = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, partition: `folio-html-test-${Date.now()}` } });
        globalThis.__FOLIO_TEST_EXPORT_PREVIEW__ = exportPreview;
        await exportPreview.loadFile(target);
      }, htmlPath);
      const preview = await opened;
      await preview.locator('h1').filter({ hasText: 'Folio compatibility atlas' }).first().waitFor();
      assert.ok(await preview.locator('.katex').count() >= 3);
      assert.ok(await preview.locator('svg').count() >= 2);
      const localImages = await preview.locator('img[alt="Local SVG illustration"],img[alt="Local PNG pixel"]').evaluateAll(async (images) => {
        await Promise.all(images.map((img) => img.decode()));
        return images.map((img) => ({ alt: img.alt, embedded: img.src.startsWith('data:'), width: img.naturalWidth }));
      });
      assert.equal(localImages.length, 2);
      assert.ok(localImages.every((img) => img.embedded && img.width > 0));
      assert.equal(await preview.evaluate(() => window.__folioXss), undefined);
      const font = await preview.evaluate(async () => { await document.fonts.ready; return document.fonts.check('12px KaTeX_Main'); });
      assert.equal(font, true, 'Embedded KaTeX font must be usable without local font files');
      await electronApp.evaluate(() => globalThis.__FOLIO_TEST_EXPORT_PREVIEW__.showInactive());
      await preview.screenshot({ path: path.join(results, 'exported-html.png'), fullPage: false, timeout: 30000 });
      await electronApp.evaluate(() => globalThis.__FOLIO_TEST_EXPORT_PREVIEW__.close());
      return { images: localImages, embeddedMathFont: font };
    });

    await check('PDF exports through the actual UI and contains valid pages', async () => {
      const stat = await exportViaUi('PDF', pdfPath);
      const bytes = await fs.readFile(pdfPath);
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      assert.match(bytes.subarray(-100).toString(), /%%EOF/);
      const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
      assert.ok(pages >= 2, `Expected a multipage fixture PDF; found ${pages} page objects`);
      report.artifacts.pdf = pdfPath;
      return { bytes: stat.size, pages, note: 'Binary structure check; separate PDF text extraction and rendered-page review cover visual fidelity.' };
    });

    await check('Wiki links open their local Markdown target', async () => {
      await page.locator('#document-content a.wiki-link').filter({ hasText: /^the companion note$/ }).click();
      await documentReady('Companion note');
      assert.match(await page.locator('#document-content').innerText(), /Local note embed succeeded/);
      await openFixture(fixture);
      await documentReady();
    });

    await check('Native Open command loads another local document', async () => {
      const target = path.join(appRoot, 'samples', 'commonmark-edge-cases.md');
      await electronApp.evaluate(({ dialog }, filePath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
      }, target);
      await page.getByRole('button', { name: 'Open file', exact: true }).click();
      await documentReady('CommonMark edge cases');
      assert.equal(await page.locator('#document-content ol').first().getAttribute('start'), '3');
      assert.match(await page.locator('#document-content').innerText(), /literal asterisk/);
      assert.equal(await page.locator('#document-content div.uppercase-html').count(), 1);
      await openFixture(fixture);
      await documentReady();
    });

    await check('Changes to an opened local file reload automatically', async () => {
      const liveFile = path.join(results, 'live-reload.md');
      await fs.writeFile(liveFile, '# Live reload\n\nInitial local content.\n');
      await openFixture(liveFile);
      await documentReady('Live reload');
      await fs.writeFile(liveFile, '# Live reload\n\nUpdated local content.\n');
      await page.locator('#document-content p').filter({ hasText: 'Updated local content.' }).waitFor({ timeout: 12000 });
      await openFixture(fixture);
      await documentReady();
    });

    await check('A native file input crosses the dropped-file preload bridge', async () => {
      await page.locator('#file-input').setInputFiles(path.join(appRoot, 'samples', 'commonmark-edge-cases.md'));
      await documentReady('CommonMark edge cases');
      assert.match(await page.locator('#document-title').textContent(), /commonmark-edge-cases\.md/);
      assert.match(await page.locator('#document-location').textContent(), /LOCAL DOCUMENT/);
      await openFixture(fixture);
      await documentReady();
    });

    await check('Unsupported runtime content stays inert and invalid diagrams do not stop reading', async () => {
      await openFixture(path.join(appRoot, 'samples', 'unsupported-dialects.md'));
      await documentReady('Unsupported dialect boundary checks');
      assert.equal(await page.evaluate(() => window.__folioMdxExecuted), undefined);
      assert.match(await page.locator('#document-content').innerText(), /Malformed but readable/);
      assert.match(await page.locator('#document-content').innerText(), /print\("This code must stay literal"\)/);
      await openFixture(fixture);
      await documentReady();
    });

    await check('Desktop and narrow layouts remain usable without page overflow', async () => {
      const windowHandle = await electronApp.browserWindow(page);
      await windowHandle.evaluate((window) => window.showInactive());
      await page.setViewportSize({ width: 1380, height: 920 });
      await page.locator('#reader-scroll').evaluate((reader) => { reader.scrollTop = 0; });
      await page.locator('#toast').waitFor({ state: 'hidden', timeout: 10000 });
      await page.screenshot({ path: path.join(results, 'screenshot.png'), fullPage: false, timeout: 30000 });
      report.artifacts.desktopScreenshot = path.join(results, 'screenshot.png');
      await page.setViewportSize({ width: 760, height: 800 });
      await page.screenshot({ path: path.join(results, 'narrow.png'), fullPage: false, timeout: 30000 });
      const layout = await page.evaluate(() => ({ width: innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth }));
      assert.ok(layout.document <= layout.width + 2, `Document overflows by ${layout.document - layout.width}px`);
      if (!(await page.getByRole('button', { name: 'Open file', exact: true }).isVisible())) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
      assert.ok(await page.getByRole('button', { name: 'Open file', exact: true }).isVisible());
      report.artifacts.narrowScreenshot = path.join(results, 'narrow.png');
      return layout;
    });

    await check('Welcome and dark reading screenshots are captured', async () => {
      await page.setViewportSize({ width: 1380, height: 920 });
      await page.locator('#theme-toggle').click();
      await page.locator('#document-content .mermaid svg').waitFor({ timeout: 30000 });
      await page.locator('#reader-scroll').evaluate((reader) => { reader.scrollTop = 0; });
      await page.screenshot({ path: path.join(results, 'dark-reading.png'), timeout: 30000 });
      await page.locator('#theme-toggle').click();
      await page.locator('#welcome-button').click();
      await page.locator('#document-content h1').first().waitFor();
      assert.equal(await page.locator('#document-content .callout .footnotes').count(), 0);
      await page.locator('#reader-scroll').evaluate((reader) => { reader.scrollTop = 0; });
      await page.screenshot({ path: path.join(results, 'welcome.png'), timeout: 30000 });
      report.artifacts.welcomeScreenshot = path.join(results, 'welcome.png');
      report.artifacts.darkScreenshot = path.join(results, 'dark-reading.png');
    });

    await check('No uncaught renderer exceptions occurred', async () => {
      assert.deepEqual(report.pageErrors, []);
      return { consoleErrorCount: report.consoleErrors.length, note: 'Missing-image and malformed-diagram fixtures may intentionally produce console diagnostics.' };
    });
  } catch (error) {
    report.fatalError = error.stack || error.message;
    process.exitCode = 1;
  } finally {
    if (page && !page.isClosed() && report.checks.some((item) => item.status === 'failed')) {
      await page.screenshot({ path: path.join(results, 'failure.png') }).catch(() => {});
    }
    if (electronApp) await electronApp.close().catch(() => {});
    report.finishedAt = new Date().toISOString();
    report.passed = !report.fatalError && report.checks.length > 0 && report.checks.every((item) => item.status === 'passed');
    await fs.writeFile(path.join(results, 'desktop-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed) process.exitCode = 1;
    console.log(`${report.checks.filter((item) => item.status === 'passed').length}/${report.checks.length} checks passed. Report: ${path.join(results, 'desktop-report.json')}`);
  }
})();
