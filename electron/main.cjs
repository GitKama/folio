const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { pdfPrintOptions } = require('./pdf.cjs');
const { readDocument, writeDocument, getRevision, normalizeNewlines, resolveAsset, isWithin, markdownExtensions, MAX_DOCUMENT_BYTES } = require('./files.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'folio', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }, { scheme: 'folio-print', privileges: { standard: true, secure: true } }]);
const testMode = process.env.FOLIO_TEST_MODE === '1';
if (testMode && process.env.FOLIO_TEST_USER_DATA) app.setPath('userData', path.resolve(process.env.FOLIO_TEST_USER_DATA));
app.setName('Folio');
app.setAppUserModelId('personal.folio.markdown');
let mainWindow, initialDocument = null, currentDocument = null, watcher = null, watchTimer, remoteImages = false;
const documents = new Map();
const loadedRemoteImages = new Set();
let recent = [];
let settingsFile;
let draft = '', actionBusy = false, allowClose = false;
let lastTestExport;
const isDirty = () => Boolean(currentDocument?.unsaved) || normalizeNewlines(draft) !== normalizeNewlines(currentDocument?.content || '');

function send(channel, value) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value); }
async function documentAction(action) {
  if (actionBusy) return null;
  actionBusy = true;
  send('folio:busy', true);
  try { return await action(); }
  finally { actionBusy = false; send('folio:busy', false); }
}

async function saveDocument(saveAs = false) {
  if (!currentDocument) return { canceled: true };
  let destination = currentDocument.path;
  let expectedRevision = currentDocument.revision;
  let format = currentDocument;
  if (!saveAs && destination) {
    const revision = await getRevision(destination);
    if (revision !== expectedRevision) {
      const result = await dialog.showMessageBox(mainWindow, { type: 'warning', title: 'File changed on disk', message: 'This file changed outside Folio.', detail: 'Your edits are still open. Save a separate copy, replace the disk version, or cancel to keep editing.', buttons: ['Save a copy…', 'Replace disk version', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true });
      if (result.response === 2) return { canceled: true };
      if (result.response === 0) saveAs = true;
      else expectedRevision = revision;
    }
  }
  if (saveAs || !destination) {
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Save Markdown as', defaultPath: destination || currentDocument.name || 'Untitled.md', filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn'] }, { name: 'Text & extended Markdown', extensions: ['txt', 'mdx', 'qmd', 'rmd'] }], properties: ['showOverwriteConfirmation', 'createDirectory'] });
    if (result.canceled || !result.filePath) return { canceled: true };
    destination = result.filePath;
    expectedRevision = await getRevision(destination);
    format = { encoding: 'UTF-8', eol: currentDocument.eol || '\n' };
  }
  const savedDraft = draft;
  const doc = await writeDocument(destination, savedDraft, { expectedRevision, format });
  // Keep edits made while the write was pending, and report the saved baseline separately.
  await adoptDocument(doc, { preserveDraft: true });
  if (normalizeNewlines(draft) === normalizeNewlines(savedDraft)) draft = doc.content;
  send('folio:document', { document: doc, saved: true, draft });
  return { document: doc };
}

async function confirmReplace() {
  if (!isDirty()) return true;
  const result = await dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Unsaved changes', message: `Save changes to ${currentDocument?.name || 'Untitled.md'}?`, detail: 'Your changes will be lost if you discard them.', buttons: ['Save', 'Discard', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true });
  if (result.response === 2) return false;
  if (result.response === 1) return true;
  return !(await saveDocument())?.canceled && !isDirty();
}

const appCsp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src folio: data: https:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
const exportCsp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const mimeTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png' };

function trusted(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame.url !== 'folio://app/index.html') throw new Error('Request blocked.');
}
function handle(name, handler) { ipcMain.handle(name, async (event, ...args) => { trusted(event); return handler(...args); }); }
function sendDocument(doc) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('folio:document', doc); }
async function saveRecent() {
  await fs.mkdir(path.dirname(settingsFile), { recursive: true });
  await fs.writeFile(settingsFile, JSON.stringify(recent, null, 2), 'utf8');
}
async function remember(doc) {
  recent = [{ path: doc.path, name: doc.name }, ...recent.filter(r => r.path !== doc.path)].slice(0, 15);
  await saveRecent().catch(() => {});
}
async function openDocument(filePath, notify = false) {
  // Validate before asking to discard anything; re-read after the dialog.
  await readDocument(filePath);
  if (!(await confirmReplace())) return null;
  const doc = await readDocument(filePath);
  await adoptDocument(doc);
  if (notify) sendDocument(doc);
  return doc;
}
async function adoptDocument(doc, { preserveDraft = false } = {}) {
  const existing = [...documents.entries()].find(([, value]) => value.path === doc.path);
  const token = existing?.[0] || crypto.randomBytes(16).toString('hex');
  doc.baseUrl = `folio://asset-${token}/`;
  documents.set(token, { path: doc.path, root: path.dirname(doc.path) });
  while (documents.size > 64) documents.delete(documents.keys().next().value);
  currentDocument = doc;
  if (!preserveDraft) draft = doc.content;
  await remember(doc);
  watchDocument(doc.path);
  return doc;
}
function watchDocument(filePath) {
  watcher?.close();
  clearTimeout(watchTimer);
  try {
    watcher = fsSync.watch(path.dirname(filePath), { persistent: false }, (_kind, filename) => {
      if (filename && filename.toString().toLowerCase() !== path.basename(filePath).toLowerCase()) return;
      clearTimeout(watchTimer);
      const reload = async () => {
        if (currentDocument?.path !== filePath) return;
        if (actionBusy) { watchTimer = setTimeout(reload, 350); return; }
        try {
          const update = await readDocument(filePath);
          if (currentDocument?.path !== filePath) return;
          if (actionBusy) { watchTimer = setTimeout(reload, 350); return; }
          if (update.revision === currentDocument.revision) return;
          if (isDirty()) { send('folio:conflict', { path: filePath }); return; }
          currentDocument = { ...update, baseUrl: currentDocument.baseUrl };
          draft = currentDocument.content;
          sendDocument(currentDocument);
        } catch { /* Atomic saves can briefly remove a file; the next filesystem event retries. */ }
      };
      watchTimer = setTimeout(reload, 350);
    });
  } catch { /* Manual reopen remains available for filesystems without watchers. */ }
}

async function chooseFile() {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Open a Markdown document', properties: ['openFile'], filters: [{ name: 'Markdown & text', extensions: [...markdownExtensions].map(e => e.slice(1)) }] });
  return result.canceled ? null : openDocument(result.filePaths[0]);
}
async function assetFromUrl(urlString) {
  const url = new URL(urlString);
  const match = /^asset-([a-f0-9]{32})$/.exec(url.hostname);
  const doc = match && documents.get(match[1]);
  if (url.protocol !== 'folio:' || !doc) throw new Error('This image is not part of an opened document.');
  return resolveAsset(doc.root, decodeURIComponent(url.pathname));
}
async function openLink({ href, fromPath } = {}) {
  if (typeof href !== 'string' || href.length > 8192) throw new Error('Invalid link.');
  if (/^https?:\/\//i.test(href)) {
    const url = new URL(href);
    if (url.username || url.password) throw new Error('Links containing credentials are not opened.');
    await shell.openExternal(url.href);
    return null;
  }
  const entry = [...documents.values()].find(doc => doc.path === fromPath);
  if (!entry) throw new Error('Open this document from disk to follow local links.');
  let value = href.split('#')[0].split('?')[0];
  if (!value) return null;
  if (/^[a-z][a-z0-9+.-]*:|^[/\\]{2}/i.test(value)) throw new Error('Only web and relative Markdown links can be opened.');
  value = decodeURIComponent(value);
  if (/^[a-z][a-z0-9+.-]*:|^[/\\]{2}/i.test(value)) throw new Error('Invalid local link.');
  let destination = path.resolve(entry.root, value);
  if (!path.extname(destination)) destination += '.md';
  const real = await fs.realpath(destination);
  if (!isWithin(entry.root, real)) throw new Error('This link is outside the document folder. Use Open file to read it.');
  return openDocument(real);
}
function safeTitle(value) { return (String(value || 'document').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\.(md|markdown|mdown|qmd|rmd)$/i, '').slice(0, 120) || 'document'); }
async function writeExport(format, html, destination, options = {}) {
  if (!['html', 'pdf'].includes(format) || typeof html !== 'string' || html.length > 90 * 1024 * 1024 || !/<html[\s>]/i.test(html) || !/<head[\s>]/i.test(html)) throw new Error('Invalid or oversized export.');
  if (path.extname(destination).toLowerCase() !== `.${format}`) throw new Error(`Choose a .${format} filename.`);
  if (testMode) lastTestExport = { format, html, options };
  // A first, restrictive CSP also protects the isolated print renderer.
  const locked = html.replace(/<head[^>]*>/i, `<head><meta http-equiv="Content-Security-Policy" content="${exportCsp}">`);
  if (format === 'html') { await fs.writeFile(destination, locked, 'utf8'); return { path: destination }; }
  const printWindow = new BrowserWindow({ show: false, width: 1000, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, partition: `folio-print-${crypto.randomBytes(8).toString('hex')}` } });
  printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  printWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  printWindow.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'file://*/*', 'folio://*/*'] }, (_details, callback) => callback({ cancel: true }));
  try {
    // Serve only this in-memory document in the isolated session. Unlike data:
    // navigation, this supports large embedded assets without a URL-size limit.
    printWindow.webContents.session.protocol.handle('folio-print', request => request.url === 'folio-print://document/'
      ? new Response(locked, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': exportCsp } })
      : new Response('Not found', { status: 404 }));
    await printWindow.loadURL('folio-print://document/');
    await printWindow.webContents.executeJavaScript('Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.complete ? Promise.resolve() : new Promise(resolve => {image.onload=resolve; image.onerror=resolve;}))])');
    // Oversized cards/rows must be allowed to continue onto another page.
    await printWindow.webContents.executeJavaScript(`(() => { const limit = 250 * 96 / 25.4; document.querySelectorAll('.pdf-card, tr, .diagram').forEach(el => { if (el.getBoundingClientRect().height > limit) el.style.breakInside = 'auto'; }); })()`);
    const pdf = await printWindow.webContents.printToPDF(pdfPrintOptions(options.title, options.pdfProfile));
    await fs.writeFile(destination, pdf);
    return { path: destination };
  } finally { printWindow.webContents.session.protocol.unhandle('folio-print'); printWindow.destroy(); }
}

async function installProtocol() {
  const dist = path.join(app.getAppPath(), 'dist');
  protocol.handle('folio', async request => {
    try {
      const url = new URL(request.url);
      if (url.hostname === 'app') {
        let rel = decodeURIComponent(url.pathname);
        if (rel === '/') rel = '/index.html';
        const file = path.resolve(dist, `.${rel}`);
        if (!isWithin(dist, file)) return new Response('Forbidden', { status: 403 });
        return new Response(await fs.readFile(file), { headers: { 'Content-Type': mimeTypes[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': appCsp, 'X-Content-Type-Options': 'nosniff' } });
      }
      const asset = await assetFromUrl(request.url);
      return new Response(asset.bytes, { headers: { 'Content-Type': asset.mime, 'Access-Control-Allow-Origin': 'folio://app', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' } });
    } catch { return new Response('Image or file not available', { status: 404 }); }
  });
}
async function createWindow() {
  mainWindow = new BrowserWindow({ width: 1360, height: 940, minWidth: 640, minHeight: 480, title: 'Folio', backgroundColor: '#f6f4ed', show: false, icon: path.join(app.getAppPath(), 'dist/icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.once('ready-to-show', () => { if (!testMode) mainWindow.show(); });
  mainWindow.on('close', event => {
    if (allowClose) return;
    // Serialize close with open/save dialogs so a pending operation cannot lose edits.
    if (actionBusy) { event.preventDefault(); return; }
    if (!isDirty()) return;
    event.preventDefault();
    documentAction(async () => {
      if (await confirmReplace()) { allowClose = true; mainWindow.close(); }
    }).catch(error => dialog.showErrorBox('Could not save changes', error.message));
  });
  mainWindow.on('closed', () => { mainWindow = null; watcher?.close(); });
  await mainWindow.loadURL('folio://app/index.html');
}

const acquired = testMode || app.requestSingleInstanceLock();
if (!acquired) app.quit();
else {
  app.on('second-instance', (_event, args) => {
    const file = args.find(arg => markdownExtensions.has(path.extname(arg).toLowerCase()) && !arg.startsWith('-'));
    if (file) documentAction(() => openDocument(file, true)).catch(error => dialog.showErrorBox('Cannot open document', error.message));
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  });
  app.whenReady().then(async () => {
    settingsFile = path.join(app.getPath('userData'), 'recent.json');
    try { const saved = JSON.parse(await fs.readFile(settingsFile, 'utf8')); recent = Array.isArray(saved) ? saved.filter(r => typeof r?.path === 'string' && typeof r?.name === 'string').slice(0, 15) : []; } catch { }
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'file://*/*'] }, (details, callback) => callback({ cancel: !(remoteImages && details.resourceType === 'image' && details.url.startsWith('https://')) }));
    session.defaultSession.webRequest.onCompleted({ urls: ['https://*/*'] }, details => {
      if (remoteImages && details.resourceType === 'image' && details.statusCode >= 200 && details.statusCode < 300) {
        loadedRemoteImages.add(details.url);
        if (loadedRemoteImages.size > 500) loadedRemoteImages.delete(loadedRemoteImages.values().next().value);
      }
    });
    await installProtocol();
    handle('folio:open', () => documentAction(chooseFile));
    ipcMain.on('folio:draft', (event, value) => {
      trusted(event);
      if (!value || typeof value.content !== 'string' || value.content.length > MAX_DOCUMENT_BYTES || value.path !== (currentDocument?.path || null)) return;
      draft = value.content;
    });
    handle('folio:save', saveAs => documentAction(() => saveDocument(saveAs === true)));
    handle('folio:memory-document', doc => documentAction(async () => {
      if (!doc || typeof doc.content !== 'string' || doc.content.length > MAX_DOCUMENT_BYTES || typeof doc.name !== 'string' || doc.name.length > 255) throw new Error('Invalid document.');
      if (!(await confirmReplace())) return null;
      watcher?.close(); clearTimeout(watchTimer);
      currentDocument = { name: doc.name, content: doc.content, path: null, baseUrl: null, encoding: 'UTF-8', unsaved: doc.unsaved === true };
      draft = doc.content;
      return currentDocument;
    }));
    handle('folio:recent', () => recent);
    handle('folio:initial', () => initialDocument);
    handle('folio:recent-open', filePath => documentAction(() => { if (!recent.some(r => r.path === filePath)) throw new Error('Choose this file using Open file.'); return openDocument(filePath); }));
    handle('folio:drop', filePath => documentAction(() => openDocument(filePath)));
    handle('folio:link', link => documentAction(() => openLink(link)));
    handle('folio:remote-images', value => { remoteImages = value === true; return remoteImages; });
    handle('folio:copy', value => {
      if (typeof value !== 'string' || value.length > 12 * 1024 * 1024) throw new Error('This text is too large to copy.');
      clipboard.writeText(value);
      return true;
    });
    handle('folio:embed', async url => {
      if (typeof url !== 'string') throw new Error('Invalid image URL.');
      if (url.startsWith('https://')) {
        if (!remoteImages || !loadedRemoteImages.has(url)) throw new Error('Load this remote image before exporting it.');
        const response = await fetch(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10000) });
        const mime = response.headers.get('content-type')?.split(';')[0];
        if (!response.ok || !/^image\/(png|jpeg|gif|webp|svg\+xml|avif|bmp|x-icon)$/.test(mime)) throw new Error('The remote image could not be embedded.');
        const chunks = []; let size = 0;
        for await (const chunk of response.body) { size += chunk.length; if (size > 20 * 1024 * 1024) throw new Error('Remote image exceeds the 20 MB limit.'); chunks.push(chunk); }
        return `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`;
      }
      const asset = await assetFromUrl(url); return `data:${asset.mime};base64,${asset.bytes.toString('base64')}`;
    });
    handle('folio:export', async ({ format, html, title, pdfProfile } = {}) => {
      if (!['html', 'pdf'].includes(format)) throw new Error('Choose HTML or PDF.');
      const result = await dialog.showSaveDialog(mainWindow, { title: `Export ${format.toUpperCase()}`, defaultPath: `${safeTitle(title)}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }], properties: ['showOverwriteConfirmation', 'createDirectory'] });
      if (result.canceled || !result.filePath) return { canceled: true };
      return writeExport(format, html, result.filePath, { title, pdfProfile });
    });
    const launchFile = (testMode && process.env.FOLIO_TEST_FILE) || process.argv.slice(app.isPackaged ? 1 : 2).find(arg => !arg.startsWith('-') && markdownExtensions.has(path.extname(arg).toLowerCase()));
    if (launchFile) {
      try { initialDocument = await openDocument(launchFile); }
      catch (error) { if (testMode) throw error; dialog.showErrorBox('Cannot open document', error.message); }
    }
    await createWindow();
    const command = value => mainWindow?.webContents.send('folio:command', value);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'File', submenu: [{ label: 'New Markdown', accelerator: 'CmdOrCtrl+N', click: () => command('new') }, { label: 'Open Markdown…', accelerator: 'CmdOrCtrl+O', click: () => command('open') }, { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => command('save') }, { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => command('save-as') }, { type: 'separator' }, { label: 'Export HTML…', click: () => command('export-html') }, { label: 'Export PDF…', accelerator: 'CmdOrCtrl+P', click: () => command('export-pdf') }, { type: 'separator' }, { role: 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { label: 'Find in document', accelerator: 'CmdOrCtrl+F', click: () => command('find') }] },
      { label: 'View', submenu: [{ label: 'Reading view', click: () => command('read') }, { label: 'Split view', click: () => command('split') }, { label: 'Source view', click: () => command('source') }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }
    ]));
    if (testMode) globalThis.__FOLIO_TEST__ = { exportHtml: (p, html) => writeExport('html', html, p), exportPdf: (p, html, options) => writeExport('pdf', html, p, options), getLastExport: () => lastTestExport, getSecurity: () => mainWindow.webContents.getLastWebPreferences(), openFile: p => documentAction(() => openDocument(p, true)), getEditorState: () => ({ dirty: isDirty(), busy: actionBusy, path: currentDocument?.path }) };
  }).catch(error => { console.error(error); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
}
