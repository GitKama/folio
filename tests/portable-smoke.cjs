const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const results = path.join(root, 'test-results', 'portable');
const executable = path.join(root, 'release', 'Folio-1.1.0-win-x64.exe');
let child, browser;

(async () => {
  await fs.mkdir(results, { recursive: true });
  const document = path.join(results, 'portable-check.md');
  await fs.writeFile(document, '# Portable launch verified\n\nBundled math: $E=mc^2$.\n\n```mermaid\nflowchart LR\n A[Portable] --> B[Standalone]\n```\n');
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const env = { ...process.env, FOLIO_TEST_MODE: '1', FOLIO_TEST_FILE: document, FOLIO_TEST_USER_DATA: path.join(results, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { env, cwd: root, windowsHide: true, stdio: 'ignore' });
  const start = Date.now();
  let ready = false;
  while (Date.now() - start < 45000) {
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(600) }); if (response.ok) { ready = true; break; } } catch { }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('The portable wrapper did not start its bundled application.');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages().find(p => p.url().startsWith('folio://app/'));
  if (!page) throw new Error('The expected Folio page was not found.');
  await page.locator('#document-content h1').filter({ hasText: 'Portable launch verified' }).waitFor({ timeout: 30000 });
  await page.locator('#document-content .mermaid svg').waitFor({ timeout: 30000 });
  if (await page.locator('#document-content .katex').count() !== 1) throw new Error('Bundled math was not rendered.');
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  const edited = (await page.locator('#source-content').inputValue()) + '\nSaved from the portable editor.\n';
  await page.locator('#source-content').fill(edited);
  await page.locator('#save-document').click();
  await page.waitForFunction(() => !document.title.startsWith('● '));
  if ((await fs.readFile(document, 'utf8')) !== edited) throw new Error('The portable editor did not save its changes.');
  await page.locator('#document-content .mermaid svg').waitFor({ timeout: 30000 });
  const verified = await page.evaluate(() => ({ title: document.title, bridge: typeof window.folio, node: typeof require, math: document.querySelectorAll('.katex').length, diagrams: document.querySelectorAll('.mermaid svg').length }));
  await fs.writeFile(path.join(results, 'portable-report.json'), JSON.stringify({ passed: true, executable, verifiedAt: new Date().toISOString(), elapsedMs: Date.now() - start, editingAndSaving: true, ...verified }, null, 2));
  console.log(JSON.stringify({ passed: true, ...verified }));
  const session = await browser.newBrowserCDPSession();
  await session.send('Browser.close').catch(() => {});
})().catch(async error => {
  console.error(error);
  process.exitCode = 1;
  await fs.mkdir(results, { recursive: true });
  await fs.writeFile(path.join(results, 'portable-report.json'), JSON.stringify({ passed: false, error: error.message }, null, 2));
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (child && child.exitCode === null) child.kill();
});
