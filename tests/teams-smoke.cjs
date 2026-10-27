/* Synthetic, isolated Electron checks. Clipboard writes are captured, not sent. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const results = path.resolve(process.env.FOLIO_TEAMS_RESULTS || path.join(root, 'test-results/teams'));
const version = require('../package.json').version;
const report = { version, checks: [], pageErrors: [], passed: false, clipboardWrites: 'captured at Electron clipboard.write', teamsClient: 'not exercised by this automated suite' };
let app, page;
async function check(name, fn) { console.log(`RUN ${name}`); await fn(); report.checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
async function copy() {
  await page.locator('#export-toggle').click();
  await page.locator('#export-teams').click();
  await page.locator('#toast').filter({ hasText: 'Copied for Teams.' }).waitFor();
  return app.evaluate(() => globalThis.__TEAMS_WRITES__.at(-1));
}
(async () => {
  await fs.mkdir(results, { recursive: true });
  const fixture = path.join(results, 'synthetic.md');
  const original = '# Teams export check\n\n**Bold** and *italic*. [Link](https://example.com)\n\n- [x] Done\n- [ ] Pending\n\n| Item | Status |\n|---|---|\n| Sample | Ready |\n\n```js\nconst value = "<safe>";\n```\n';
  await fs.writeFile(fixture, original);
  const env = { ...process.env, FOLIO_TEST_MODE: '1', FOLIO_TEST_FILE: fixture, FOLIO_TEST_USER_DATA: path.join(results, `profile-${Date.now()}`) };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    app = await electron.launch({ executablePath: process.env.FOLIO_TEST_EXECUTABLE || require('electron'), args: process.env.FOLIO_TEST_EXECUTABLE ? [] : [root], cwd: root, env, timeout: 45000 });
    page = await app.firstWindow(); page.setDefaultTimeout(30000);
    await app.evaluate(({ clipboard, ClipboardItem, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
      globalThis.__TEAMS_WRITES__ = [];
      clipboard.write = async items => {
        await new Promise(resolve => setTimeout(resolve, 50));
        if (globalThis.__TEAMS_FAIL__) throw new Error('Synthetic clipboard failure');
        if (!Array.isArray(items) || items.length !== 1 || !(items[0] instanceof ClipboardItem)) throw new Error('Expected the real Electron ClipboardItem API');
        const item = items[0];
        if (item.types.length !== 2 || !item.types.includes('text/html') || !item.types.includes('text/plain')) throw new Error('Unexpected clipboard formats');
        globalThis.__TEAMS_WRITES__.push({ html: await (await item.getType('text/html')).text(), text: await (await item.getType('text/plain')).text() });
      };
    });
    page.on('pageerror', error => report.pageErrors.push(error.message));
    await page.locator('#document-content h1').filter({ hasText: 'Teams export check' }).waitFor();
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);

    await check('Export UI writes HTML and readable text through the native bridge', async () => {
      const value = await copy();
      assert.match(value.html, /<strong>Bold<\/strong>/);
      assert.match(value.html, /<em>italic<\/em>/);
      assert.match(value.html, /<a href="https:\/\/example.com\//);
      assert.match(value.text, /Item: Sample\nStatus: Ready/);
      assert.doesNotMatch(value.html, /<table|<input|<script/);
      await fs.writeFile(path.join(results, 'clipboard.html'), value.html);
      await fs.writeFile(path.join(results, 'clipboard.txt'), value.text);
    });
    await check('Conversion notes and paste guidance are visible in Document details', async () => {
      await page.locator('#compatibility-toggle').click();
      assert.match(await page.locator('#details-content').innerText(), /Last Teams copy[\s\S]*Tables become labeled rows/);
      await page.locator('#details-close').click();
      await page.locator('#export-toggle').click();
      await page.locator('#export-menu').waitFor({ state: 'visible' });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
      await page.screenshot({ path: path.join(results, 'teams-menu.png') });
      await page.keyboard.press('Escape');
    });
    await check('Immediate export includes unsaved edits and leaves the source file unchanged', async () => {
      await page.getByRole('button', { name: 'Source', exact: true }).click();
      await page.locator('#source-content').fill('# Latest unsaved\n\n**Fresh** text\n');
      const value = await copy();
      assert.match(value.html, /Latest unsaved/);
      assert.match(value.html, /<strong>Fresh<\/strong>/);
      assert.equal(await fs.readFile(fixture, 'utf8'), original);
      assert.equal(await app.evaluate(() => globalThis.__FOLIO_TEST__.getEditorState().dirty), true);
    });
    await check('Native File menu invokes the same Teams export', async () => {
      const before = await app.evaluate(() => globalThis.__TEAMS_WRITES__.length);
      await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === 'Copy for Teams').click());
      await app.evaluate(async (_, expected) => {
        const deadline = Date.now() + 5000;
        while (globalThis.__TEAMS_WRITES__.length < expected && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      }, before + 1);
      assert.equal(await app.evaluate(() => globalThis.__TEAMS_WRITES__.length), before + 1);
    });
    await check('Oversize export does not truncate or replace clipboard contents', async () => {
      const before = await app.evaluate(() => globalThis.__TEAMS_WRITES__.length);
      await page.locator('#source-content').fill('你'.repeat(28000));
      await page.locator('#export-toggle').click(); await page.locator('#export-teams').click();
      await page.locator('#toast.error').filter({ hasText: '80 KB' }).waitFor();
      assert.equal(await app.evaluate(() => globalThis.__TEAMS_WRITES__.length), before);
      assert.equal(await page.locator('#export-toggle').isEnabled(), true);
    });
    await check('Native IPC rejects malformed and oversized payloads', async () => {
      const errors = await page.evaluate(async () => {
        const results = [];
        for (const payload of [null, { html: 1, text: 'x' }, { html: '<b>x</b>', text: '' }, { html: 'a'.repeat(90000), text: 'x' }]) {
          try { await window.folio.copyTeams(payload); results.push('accepted'); } catch { results.push('rejected'); }
        }
        return results;
      });
      assert.deepEqual(errors, ['rejected', 'rejected', 'rejected', 'rejected']);
    });
    await check('Clipboard errors remain visible and the export can be retried', async () => {
      await page.locator('#source-content').fill('Retry **sample**');
      await app.evaluate(() => { globalThis.__TEAMS_FAIL__ = true; });
      await page.locator('#export-toggle').click(); await page.locator('#export-teams').click();
      await page.locator('#toast.error').filter({ hasText: 'Synthetic clipboard failure' }).waitFor();
      assert.equal(await page.locator('#export-toggle').isEnabled(), true);
      await app.evaluate(() => { globalThis.__TEAMS_FAIL__ = false; });
      assert.match((await copy()).html, /<strong>sample<\/strong>/);
    });
    await check('Menu remains accessible at minimum size and in dark mode', async () => {
      await page.setViewportSize({ width: 640, height: 480 });
      if (await page.locator('#sidebar-scrim').isVisible()) await page.locator('#sidebar-scrim').click();
      await page.locator('#theme-toggle').click();
      await page.locator('#export-toggle').click();
      const button = await page.locator('#export-teams').boundingBox();
      assert.ok(button && button.x >= 0 && button.y >= 0 && button.x + button.width <= 640 && button.y + button.height <= 480);
      await page.screenshot({ path: path.join(results, 'teams-menu-narrow-dark.png') });
    });
    assert.deepEqual(report.pageErrors, []);
    report.passed = true;
  } catch (error) { report.error = error.stack; console.error(error); process.exitCode = 1; }
  finally {
    if (app) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {});
      await app.close().catch(() => {});
    }
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(results, 'teams-report.json'), JSON.stringify(report, null, 2));
    console.log(`${report.checks.length} Teams checks passed; overall: ${report.passed}`);
  }
})();
