/* Exercise the actual PDF dialog and native Chromium export, using synthetic data. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const results = path.resolve(process.env.FOLIO_PDF_RESULTS || path.join(root, 'test-results/pdf'));
const fixture = path.resolve(process.env.FOLIO_PDF_FIXTURE || path.join(root, 'samples/meeting.md'));
const version = require('../package.json').version;
const report = { version, checks: [], pageErrors: [], passed: false };
let app, page;
async function check(name, action) {
  console.log(`RUN  ${name}`);
  await action(); report.checks.push({ name, passed: true }); console.log(`PASS ${name}`);
}
async function options() {
  await page.locator('#export-toggle').click();
  await page.locator('#export-pdf').click();
  await page.locator('#pdf-dialog').waitFor({ state: 'visible' });
}
async function exportPdf(name, profile, cards, meetings) {
  const target = path.join(results, `${name}.pdf`);
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, target);
  await options();
  await page.locator(`[name="pdf-profile"][value="${profile}"]`).check();
  if (cards !== undefined) await page.locator('#pdf-cards').setChecked(cards);
  if (meetings !== undefined) await page.locator('#pdf-meetings').setChecked(meetings);
  await page.locator('#pdf-save').click();
  await page.waitForFunction(() => !document.getElementById('export-toggle').disabled, { timeout: 60000 });
  const pdf = await fs.readFile(target);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 5000);
  const exported = await app.evaluate(() => globalThis.__FOLIO_TEST__.getLastExport());
  assert.equal(exported.options.pdfProfile, profile);
  await fs.writeFile(path.join(results, `${name}.html`), exported.html);
  return exported.html;
}
(async () => {
  await fs.mkdir(results, { recursive: true });
  const original = await fs.readFile(fixture, 'utf8');
  const env = { ...process.env, FOLIO_TEST_MODE: '1', FOLIO_TEST_FILE: fixture, FOLIO_TEST_USER_DATA: path.join(results, `profile-${Date.now()}`) };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    app = await electron.launch({ executablePath: process.env.FOLIO_TEST_EXECUTABLE || require('electron'), args: process.env.FOLIO_TEST_EXECUTABLE ? [] : [root], cwd: root, env, timeout: 45000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
    page = await app.firstWindow(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    await page.locator('#document-content h1').first().waitFor();
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
    await check('Technical defaults, keyboard cancellation and dialog layout', async () => {
      await options();
      assert.equal(await page.locator('[value="technical"]').isChecked(), true);
      assert.equal(await page.locator('#pdf-cards').isChecked(), true);
      assert.equal(await page.locator('#pdf-meetings').isChecked(), true);
      const screenshot = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      await fs.writeFile(path.join(results, 'pdf-dialog.png'), Buffer.from(screenshot, 'base64'));
      assert.equal(await page.locator('#pdf-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#pdf-dialog').isVisible(), false);
      await page.setViewportSize({ width: 640, height: 480 });
      await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(item => item.accelerator === 'CmdOrCtrl+P').click());
      await page.locator('#pdf-dialog').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#pdf-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      const save = await page.locator('#pdf-save').boundingBox();
      assert.ok(save && save.y >= 0 && save.y + save.height <= 480);
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1344, height: 875 });
    });
    for (const profile of ['technical', 'studio', 'editorial']) {
      await check(`${profile} exports through the dialog without changing Markdown`, async () => {
        const html = await exportPdf(profile, profile);
        assert.ok(html.includes(`data-pdf-profile="${profile}"`));
        assert.ok(html.includes('data-theme="light"'));
        if (profile === 'studio') assert.ok(!html.includes('class="pdf-card"'));
        else assert.ok(html.includes('class="pdf-card"'));
        assert.equal(await fs.readFile(fixture, 'utf8'), original);
        assert.equal((await app.evaluate(() => globalThis.__FOLIO_TEST__.getEditorState())).dirty, false);
      });
    }
    await check('Export choices persist after reloading the app', async () => {
      await page.reload(); await page.locator('#document-content h1').first().waitFor();
      await options();
      assert.equal(await page.locator('[value="editorial"]').isChecked(), true);
      assert.equal(await page.locator('#pdf-cards').isChecked(), true);
      assert.equal(await page.locator('#pdf-meetings').isChecked(), false);
      await page.keyboard.press('Escape');
    });
    await check('Latest unsaved edit exports in light typography from dark reading mode', async () => {
      await app.evaluate(async (_e, file) => globalThis.__FOLIO_TEST__.openFile(file), fixture);
      await page.getByRole('button', { name: 'Split', exact: true }).click();
      await page.locator('#source-content').fill(original + '\n\nLATEST_UNSAVED_PDF_SENTINEL\n');
      if (await page.locator('html').getAttribute('data-theme') !== 'dark') await page.locator('#theme-toggle').click();
      const html = await exportPdf('unsaved-dark', 'technical', false, false);
      assert.ok(html.includes('LATEST_UNSAVED_PDF_SENTINEL'));
      assert.ok(html.includes('data-theme="light"'));
      assert.equal(await fs.readFile(fixture, 'utf8'), original);
      assert.equal((await app.evaluate(() => globalThis.__FOLIO_TEST__.getEditorState())).dirty, true);
    });
    await check('Canceling native save preserves the draft', async () => {
      const before = await page.locator('#source-content').inputValue();
      await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
      await options(); await page.locator('#pdf-save').click();
      await page.waitForFunction(() => !document.getElementById('export-toggle').disabled);
      assert.equal(await page.locator('#source-content').inputValue(), before);
    });
    await check('Long grids, long code and oversized cards remain printable', async () => {
      const rows = Array.from({ length: 100 }, (_, i) => `| ROW_${String(i).padStart(3, '0')} | Owner ${i} | Description ${i} | Later |`).join('\n');
      const stress = '# Pagination stress\n\n| Item | Owner | Detail | Due |\n|---|---|---|---|\n' + rows + '\n\n```text\n' + Array.from({ length: 100 }, (_, i) => `CODE_${String(i).padStart(3, '0')} ${'Long text '.repeat(10)}`).join('\n') + '\n```\n\nEND_OF_STRESS\n';
      await page.locator('#source-content').fill(stress);
      await exportPdf('stress-grid', 'studio', false, false);
      const huge = '# Oversized card\n\n| Item | Owner | Detail | Due |\n|---|---|---|---|\n| Long task | Ada | ' + 'An oversized task must continue across pages without losing text. '.repeat(180) + 'FINAL_CARD_SENTINEL | Later |\n';
      await page.locator('#source-content').fill(huge);
      await exportPdf('stress-card', 'technical', true, false);
    });
    await check('Large export HTML bypasses data URL limits and blocks scripts', async () => {
      const target = path.join(results, 'large.pdf');
      const html = '<!doctype html><html><head><title>Large export</title></head><body><h1>LARGE_EXPORT_SENTINEL</h1><p id="result">SCRIPT_BLOCKED</p><script>document.getElementById("result").textContent="SCRIPT_EXECUTED"</script><!--' + 'x'.repeat(3 * 1024 * 1024) + '--></body></html>';
      await app.evaluate(async (_e, args) => globalThis.__FOLIO_TEST__.exportPdf(args.target, args.html, { title: 'Large export', pdfProfile: 'technical' }), { target, html });
      assert.ok((await fs.stat(target)).size > 5000);
    });
    assert.deepEqual(report.pageErrors, []);
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; console.error(error); }
  finally {
    if (page && !report.passed) await page.screenshot({ path: path.join(results, 'failure.png') }).catch(() => {});
    if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
    await fs.writeFile(path.join(results, 'pdf-report.json'), JSON.stringify(report, null, 2));
    console.log(`${report.checks.length} PDF checks passed; overall: ${report.passed}`);
  }
})();
