const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const results = path.resolve(process.env.FOLIO_EDITOR_RESULTS || path.join(root, 'test-results/editor'));
const executablePath = process.env.FOLIO_TEST_EXECUTABLE || path.join(root, 'node_modules/electron/dist/electron.exe');
let app, page;
const report = { checks: [], pageErrors: [], executablePath, startedAt: new Date().toISOString() };
async function check(name, run) {
  console.log(`RUN ${name}`);
  try { await run(); report.checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, passed: false, error: error.stack }); throw error; }
}
async function dialogs({ response = 2, savePath = null, openPath = null } = {}) {
  await app.evaluate(({ dialog }, args) => {
    globalThis.editorDialogs = [];
    dialog.showMessageBox = async (_window, options) => { globalThis.editorDialogs.push(options); return { response: args.response }; };
    dialog.showSaveDialog = async () => ({ canceled: !args.savePath, filePath: args.savePath });
    dialog.showOpenDialog = async () => ({ canceled: !args.openPath, filePaths: args.openPath ? [args.openPath] : [] });
    dialog.showErrorBox = (title, message) => { globalThis.editorDialogs.push({ title, message }); };
  }, { response, savePath, openPath });
}
async function settled() {
  await page.waitForFunction(() => !document.querySelector('#source-content').readOnly);
  await app.evaluate(() => { if (globalThis.__FOLIO_TEST__.getEditorState().busy) throw new Error('Main process still busy'); });
}
async function dirty(value) {
  await page.waitForFunction(expected => document.title.startsWith('● ') === expected, value);
  assert.equal(await app.evaluate(() => globalThis.__FOLIO_TEST__.getEditorState().dirty), value);
}
async function save(as = false) {
  await page.evaluate(flag => window.folio.saveDocument(flag), as);
  await settled();
}
async function open(target) {
  await app.evaluate(async (_, p) => globalThis.__FOLIO_TEST__.openFile(p), target);
  await settled();
}
async function disk(name, content) { assert.equal(await fs.readFile(name, 'utf8'), content); }

(async () => {
  await fs.mkdir(results, { recursive: true });
  const file = path.join(results, 'writing.md');
  const other = path.join(results, 'other.md');
  const copy = path.join(results, 'copy.md');
  const initial = '# Editing in Folio\r\n\r\nOriginal text.\r\n';
  await fs.writeFile(file, initial);
  await fs.writeFile(other, '# Another document\n');
  const env = { ...process.env, FOLIO_TEST_MODE: '1', FOLIO_TEST_FILE: file, FOLIO_TEST_USER_DATA: path.join(results, `profile-${Date.now()}`) };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    app = await electron.launch({ executablePath, args: process.env.FOLIO_TEST_EXECUTABLE ? [] : [root], env, cwd: root, timeout: 45000 });
    report.version = await app.evaluate(({ app }) => app.getVersion());
    assert.equal(report.version, require('../package.json').version);
    page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    await page.locator('#document-content h1').filter({ hasText: 'Editing in Folio' }).waitFor();
    const editor = page.locator('#source-content');
    await page.getByRole('button', { name: 'Split', exact: true }).click();

    await check('Source and split edit the same text; preview, caret, undo and redo survive rendering', async () => {
      await editor.click();
      await editor.press('Control+End');
      await editor.pressSequentially('A new sentence.');
      await page.locator('#document-content p').filter({ hasText: 'A new sentence.' }).waitFor();
      const selection = await editor.evaluate(el => [el.selectionStart, el.selectionEnd, el.value.length]);
      assert.equal(selection[0], selection[2]); assert.equal(selection[1], selection[2]);
      await dirty(true);
      await editor.press('Control+z');
      assert.doesNotMatch(await editor.inputValue(), /A new sentence\./);
      await editor.press('Control+y');
      assert.match(await editor.inputValue(), /A new sentence\./);
      await page.getByRole('button', { name: 'Source', exact: true }).click();
      assert.equal(await editor.isEditable(), true);
      await page.getByRole('button', { name: 'Split', exact: true }).click();
      await disk(file, initial);
    });

    const edited = '# Editing in Folio\n\n**Saved changes** with Café 日本語 😀.\n';
    await check('Ctrl+S writes real Markdown, preserves CRLF and resets dirty state', async () => {
      await editor.fill(edited);
      await editor.press('Control+s');
      await dirty(false);
      await disk(file, edited.replace(/\n/g, '\r\n'));
      await page.locator('#document-content strong').filter({ hasText: 'Saved changes' }).waitFor();
      await editor.press('Control+End'); await editor.pressSequentially('x');
      await dirty(true); await editor.press('Control+z'); await dirty(false);
    });

    await check('Cancel Open, discard prompt and Save As preserve the active draft', async () => {
      await editor.fill('# Unsaved draft\n');
      await dialogs();
      await page.locator('#open-file').click(); await settled();
      assert.equal(await editor.inputValue(), '# Unsaved draft\n');
      await dialogs({ openPath: other, response: 2 });
      await page.locator('#open-file').click(); await settled();
      assert.equal(await editor.inputValue(), '# Unsaved draft\n');
      await save(true); await dirty(true);
      await disk(file, edited.replace(/\n/g, '\r\n'));
    });

    await check('Failed save keeps edits and prevents a Save-and-open transition', async () => {
      await dialogs({ response: 0, savePath: path.join(results, 'invalid.html') });
      await assert.rejects(page.evaluate(() => window.folio.saveDocument(true)), /filename/);
      await dirty(true);
      await disk(file, edited.replace(/\n/g, '\r\n'));
      // A new in-memory draft needs a destination when Save is chosen before Open.
      await dialogs({ response: 1 });
      await page.locator('#new-document').click(); await settled();
      await editor.fill('# New unsaved\n');
      await dialogs({ response: 0, savePath: path.join(results, 'missing-folder', 'failed.md'), openPath: other });
      await page.locator('#open-file').click();
      await page.locator('#toast').filter({ hasText: 'Could not open' }).waitFor();
      await settled(); await dirty(true);
      assert.equal(await editor.inputValue(), '# New unsaved\n');
    });

    await check('Save As creates a UTF-8 document and later Save updates only that copy', async () => {
      await dialogs({ savePath: copy });
      await editor.press('Control+Shift+s');
      await dirty(false); await disk(copy, '# New unsaved\n');
      await editor.fill('# Copy edited\n'); await save(); await dirty(false);
      await disk(copy, '# Copy edited\n'); await disk(file, edited.replace(/\n/g, '\r\n'));
      assert.match(await page.locator('#document-title').textContent(), /copy.md/);
    });

    await check('External changes during an Open dialog reload after Cancel', async () => {
      await app.evaluate(({ dialog }) => {
        dialog.showOpenDialog = () => new Promise(resolve => { globalThis.releaseOpenDialog = () => resolve({ canceled: true }); });
      });
      await page.locator('#open-file').click();
      await page.waitForFunction(() => document.querySelector('#source-content').readOnly);
      await fs.writeFile(copy, '# Changed during dialog\n');
      await new Promise(resolve => setTimeout(resolve, 700));
      await app.evaluate(() => globalThis.releaseOpenDialog());
      await page.waitForFunction(() => document.querySelector('#source-content').value === '# Changed during dialog\n');
      await dirty(false);
    });

    await check('External changes reload clean documents but cannot replace unsaved edits', async () => {
      await fs.writeFile(copy, '# External clean\n');
      await page.waitForFunction(() => document.querySelector('#source-content').value === '# External clean\n');
      await editor.fill('# My conflict draft\n');
      await fs.writeFile(copy, '# External conflict\n');
      await page.locator('#toast').filter({ hasText: 'changed outside Folio' }).waitFor();
      assert.equal(await editor.inputValue(), '# My conflict draft\n');
      await dialogs({ response: 2 }); await save(); await dirty(true);
      await disk(copy, '# External conflict\n');
      await dialogs({ response: 1 }); await save(); await dirty(false);
      await disk(copy, '# My conflict draft\n');
    });

    await check('Conflict Save a copy preserves the external version', async () => {
      await editor.fill('# Keep both\n'); await fs.writeFile(copy, '# Someone else\n');
      const conflictCopy = path.join(results, 'conflict-copy.md');
      await dialogs({ response: 0, savePath: conflictCopy }); await save(); await dirty(false);
      await disk(copy, '# Someone else\n'); await disk(conflictCopy, '# Keep both\n');
    });

    await check('Save then Open persists edits; Discard opens without writing them', async () => {
      await editor.fill('# Saved before open\n');
      await dialogs({ response: 0, openPath: other });
      await page.locator('#open-file').click();
      await page.waitForFunction(() => document.querySelector('#source-content').value === '# Another document\n');
      await disk(path.join(results, 'conflict-copy.md'), '# Saved before open\n');
      await editor.fill('# Discard me\n'); await dialogs({ response: 1 });
      await open(file); await dirty(false); await disk(other, '# Another document\n');
    });

    await check('New, Welcome, recent files, dropped files and local links honor Cancel', async () => {
      await editor.fill('# Retain this\n\n[Other](other.md)\n');
      await page.locator('#document-content a').filter({ hasText: 'Other' }).waitFor();
      await dialogs({ response: 2 });
      for (const selector of ['#new-document', '#welcome-button', '#recent-files button', '#document-content a']) {
        await page.locator(selector).first().click(); await settled();
        assert.match(await editor.inputValue(), /Retain this/);
      }
      await page.locator('#file-input').setInputFiles(other); await settled();
      assert.match(await editor.inputValue(), /Retain this/);
      await dirty(true);
    });

    await check('Pasted Markdown is unsaved and can be saved to a real file', async () => {
      await dialogs({ response: 1 });
      await page.locator('#paste-open').click();
      await page.locator('#paste-content').fill('# Pasted writing\n');
      await page.locator('#paste-submit').click();
      await page.waitForFunction(() => document.querySelector('#source-content').value === '# Pasted writing\n');
      await dirty(true);
      const pasted = path.join(results, 'pasted.md');
      await dialogs({ savePath: pasted }); await save(); await dirty(false);
      await disk(pasted, '# Pasted writing\n');
    });

    await check('Immediate HTML export includes the latest unsaved edit', async () => {
      const target = path.join(results, 'latest.html');
      await dialogs({ savePath: target });
      await editor.fill('# Latest unsaved export\n\nFresh **bold** text.\n');
      await page.locator('#export-toggle').click(); await page.locator('#export-html').click();
      await page.locator('#toast').filter({ hasText: 'HTML saved' }).waitFor();
      assert.match(await fs.readFile(target, 'utf8'), /Latest unsaved export/);
      await disk(path.join(results, 'pasted.md'), '# Pasted writing\n');
      await dirty(true);
    });

    await check('Editor layouts work at desktop and minimum window width', async () => {
      await editor.fill('# Writing in Folio\n\nEdit Markdown on the left. See it take shape on the right.\n\n## Ready when you are\n\n- Live preview as you type\n- **Ctrl+S** to save\n- Undo and redo\n- Save As to keep a copy\n\n> Your ideas, in your own files.\n');
      await page.locator('#document-content h1').filter({ hasText: 'Writing in Folio' }).waitFor();
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
      await page.setViewportSize({ width: 1380, height: 920 });
      await page.locator('#toast').waitFor({ state: 'hidden', timeout: 15000 });
      await page.screenshot({ path: path.join(results, 'editor.png'), timeout: 30000 });
      await page.setViewportSize({ width: 640, height: 600 });
      if (await page.locator('#sidebar-scrim').isVisible()) await page.locator('#sidebar-scrim').click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      assert.equal(await editor.isEditable(), true);
      assert.equal(await page.locator('#save-document').isVisible(), true);
      await page.screenshot({ path: path.join(results, 'editor-narrow.png') });
      await page.setViewportSize({ width: 1380, height: 920 });
    });

    await check('Close Cancel retains the window and draft', async () => {
      await dialogs({ response: 2 });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      await settled();
      await dirty(true);
      assert.equal(page.isClosed(), false);
      assert.match(await editor.inputValue(), /Writing in Folio/);
    });

    await check('Close Save persists the draft before the application exits', async () => {
      await dialogs({ response: 0 });
      const expected = await editor.inputValue();
      const closed = page.waitForEvent('close');
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
      await closed;
      await disk(path.join(results, 'pasted.md'), expected);
    });
    assert.deepEqual(report.pageErrors, []);
    report.passed = true;
  } catch (error) { report.passed = false; report.error = error.stack; console.error(error); process.exitCode = 1; }
  finally {
    if (page && !page.isClosed() && !report.passed) await page.screenshot({ path: path.join(results, 'failure.png') }).catch(() => {});
    if (app) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
      await app.close().catch(() => {});
    }
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(results, 'editor-report.json'), JSON.stringify(report, null, 2));
    console.log(`${report.checks.filter(x => x.passed).length}/${report.checks.length} editor checks passed`);
  }
})();
