import './style.css';
import './document.css';
import 'katex/dist/katex.min.css';
import { renderMarkdown, profiles } from './engine.js';
import { hydrateDiagrams } from './diagrams.js';
import { buildStandaloneHtml } from './export.js';
import { demoDocument } from './demo.js';

const icons = {
  folio: '<path d="M5 3h14v18H5z"/><path d="M9 7h6M9 11h6M9 15h3"/>',
  open: '<path d="M3 7h6l2 2h10l-2 11H3z"/><path d="M3 7V4h6l2 3h8v2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  moon: '<path d="M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13Z"/>',
  export: '<path d="M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  file: '<path d="M14 3H5v18h14V8zM14 3v5h5M9 13h6M9 17h6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  paste: '<path d="M9 5H5v16h14V5h-4"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h6"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 3M12 17v.1"/>',
  up: '<path d="m7 14 5-5 5 5"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const uiElements = new Map();
const byId = id => uiElements.get(id) || document.getElementById(id);
const profileLabel = id => ({ auto: 'Automatic', commonmark: 'CommonMark', gfm: 'GitHub', extended: 'Extended', obsidian: 'Obsidian' })[id] || id;
const defaults = { theme: 'light', view: 'read', profile: 'auto', fontSize: 17, breaks: false, sidebar: true, remoteImages: false };
let saved = {};
try { saved = JSON.parse(localStorage.getItem('folio.settings') || '{}'); } catch { /* A fresh preference set is safe. */ }
const state = {
  ...defaults,
  ...saved,
  theme: ['light', 'dark'].includes(saved.theme) ? saved.theme : defaults.theme,
  view: ['read', 'split', 'source'].includes(saved.view) ? saved.view : defaults.view,
  profile: profiles.some(item => item.id === saved.profile) ? saved.profile : defaults.profile,
  fontSize: Math.min(24, Math.max(14, Number(saved.fontSize) || defaults.fontSize)),
  doc: demoDocument,
  result: null,
  recent: [],
  warnings: [],
  searchMarks: [],
  searchIndex: -1,
};
let renderGeneration = 0;
let renderPromise = Promise.resolve();
let headingObserver;
let noticeTimer;
let dragDepth = 0;
const bridge = window.folio;

document.getElementById('app').innerHTML = `
  <div class="app-shell" id="app-shell">
    <aside class="sidebar" aria-label="Document navigation">
      <div class="brand"><span class="brand-mark">${icon('folio')}</span><span>folio<span class="brand-dot">.</span></span><span class="brand-caption">A CLEARER VIEW</span></div>
      <button class="open-button" id="open-file" title="Open file" aria-label="Open file">${icon('plus')}<span>Open document</span><kbd>Ctrl O</kbd></button>
      <button class="paste-link" id="paste-open">${icon('paste')}<span>Paste Markdown</span></button>
      <div class="sidebar-scroll">
        <details class="sidebar-section" open>
          <summary><span>IN THIS DOCUMENT</span>${icon('chevron')}</summary>
          <nav id="outline" aria-label="Table of contents"></nav>
        </details>
        <details class="sidebar-section recent-section" open>
          <summary><span>RECENT DOCUMENTS</span>${icon('chevron')}</summary>
          <div id="recent-files" class="recent-files"></div>
        </details>
      </div>
      <div class="sidebar-foot"><button id="welcome-button" title="Open the welcome document">${icon('folio')}<span>Welcome to Folio</span></button><button id="help-button" title="Keyboard shortcuts and format support" aria-label="Help">${icon('help')}</button></div>
      <div class="sidebar-version">MADE FOR THE WAY YOU READ</div>
    </aside>
    <button class="sidebar-scrim" id="sidebar-scrim" aria-label="Close navigation"></button>
    <div class="main-shell">
      <header class="toolbar">
        <div class="toolbar-leading"><button class="icon-button" id="sidebar-toggle" title="Toggle navigation" aria-label="Toggle navigation">${icon('sidebar')}</button><div class="file-identity">${icon('file')}<span id="document-title">Welcome to Folio.md</span><span class="file-modified" id="file-modified" title="The document reloaded from disk"></span></div></div>
        <div class="view-switch" role="group" aria-label="Document view"><button data-view="read" aria-pressed="true">Read</button><button data-view="split" aria-pressed="false">Split</button><button data-view="source" aria-pressed="false">Source</button></div>
        <div class="toolbar-actions">
          <button class="icon-button" id="search-toggle" title="Find in document (Ctrl+F)" aria-label="Find in document">${icon('search')}</button>
          <button class="icon-button" id="theme-toggle" title="Switch to dark theme" aria-label="Switch to dark theme">${icon('moon')}</button>
          <button class="icon-button" id="settings-toggle" title="Reading settings" aria-label="Reading settings" aria-expanded="false">${icon('settings')}</button>
          <div class="popover-anchor"><button class="export-button" id="export-toggle" title="Export document" aria-expanded="false">${icon('export')}<span>Export</span>${icon('chevron')}</button>
            <div class="menu popover" id="export-menu" hidden><span class="popover-eyebrow">TAKE IT WITH YOU</span><button id="export-html" title="Export HTML" aria-label="Export HTML">${icon('file')}<span><strong>Standalone HTML</strong><small>A self-contained reading copy</small></span></button><button id="export-pdf" title="Export PDF" aria-label="Export PDF">${icon('file')}<span><strong>PDF document</strong><small>Ready to print or share</small></span></button></div>
          </div>
        </div>
      </header>
      <div class="search-bar" id="search-bar" hidden><div class="search-field">${icon('search')}<input id="search-input" type="search" placeholder="Find in this document…" aria-label="Search document" autocomplete="off"/><span id="search-count" aria-live="polite"></span></div><button class="icon-button" id="search-prev" title="Previous match (Shift+Enter)" aria-label="Previous match">${icon('up')}</button><button class="icon-button" id="search-next" title="Next match (Enter)" aria-label="Next match">${icon('down')}</button><button class="icon-button" id="search-close" title="Close search (Esc)" aria-label="Close search">${icon('close')}</button></div>
      <div class="document-bar"><div class="document-context"><span class="context-dot"></span><span id="document-location">YOUR READING SPACE</span></div><div class="document-options"><label class="profile-selector" title="Choose how Markdown is interpreted"><span>Format</span><select id="profile-select" aria-label="Markdown format">${profiles.map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profileLabel(profile.id))}</option>`).join('')}</select>${icon('chevron')}</label><button class="compatibility-button" id="compatibility-toggle" title="Document details and compatibility" aria-label="Document details and compatibility" aria-expanded="false">${icon('info')}<span id="compatibility-label">Document details</span><span id="warning-count" hidden></span></button></div></div>
      <main class="workspace" id="workspace">
        <section class="source-pane" id="source-pane" aria-label="Markdown source"><div class="source-heading"><span>MARKDOWN SOURCE</span><button class="icon-button" id="copy-source" title="Copy Markdown source" aria-label="Copy Markdown source">${icon('copy')}</button></div><textarea id="source-content" spellcheck="false" readonly aria-label="Read-only Markdown source" wrap="off"></textarea><div class="source-foot">Source preview <span>·</span> <button id="source-paste">Paste another document</button></div></section>
        <div class="reader-scroll" id="reader-scroll"><div class="reading-paper"><div class="document-kicker" id="document-kicker"><span class="kicker-line"></span><span id="kicker-label">THE FOLIO FIELD GUIDE</span></div><article class="folio-document" id="document-content" tabindex="-1" aria-label="Rendered Markdown document"></article><div class="document-end"><span></span>${icon('folio')}<span></span></div></div></div>
        <aside class="details-panel" id="details-panel" hidden aria-label="Document details"><div class="panel-heading"><h2>Document details</h2><button class="icon-button" id="details-close" title="Close details" aria-label="Close document details">${icon('close')}</button></div><div id="details-content"></div></aside>
      </main>
      <footer class="status-bar"><div><span class="status-ready-dot" id="status-dot"></span><span id="status-message">Ready to read</span></div><div class="status-stats"><span id="word-count"></span><span class="status-separator">·</span><span id="reading-time"></span><span class="status-separator optional-status">·</span><span class="optional-status" id="format-status"></span></div></footer>
    </div>
    <section class="settings-panel popover" id="settings-panel" hidden aria-label="Reading settings"><span class="popover-eyebrow">MAKE YOURSELF COMFORTABLE</span><h2>Reading settings</h2><div class="setting-row"><label for="font-size">Text size</label><output id="font-size-value">17 px</output></div><input id="font-size" type="range" min="14" max="24" step="1" value="17"/><div class="size-hints"><span>Aa</span><span>Aa</span></div><label class="checkbox-setting"><span><strong>Soft line breaks</strong><small>Render each source line on a new line</small></span><input type="checkbox" id="line-breaks"/></label><label class="checkbox-setting"><span><strong>Load remote images</strong><small>Allow images from websites referenced by a document</small></span><input type="checkbox" id="remote-images"/></label><p class="settings-note">Your reading preferences are saved on this device.</p></section>
    <div class="drop-overlay" id="drop-overlay" hidden><div>${icon('open')}<h2>A fresh page awaits.</h2><p>Drop your Markdown document here</p><span>.md · .markdown · .mdx · .txt</span></div></div>
    <div class="toast" id="toast" role="status" hidden></div>
    <input type="file" id="file-input" accept=".md,.markdown,.mdown,.mkd,.mkdn,.mdx,.qmd,.rmd,.txt" hidden/>
    <dialog id="paste-dialog" class="folio-dialog"><form method="dialog"><div class="dialog-heading"><div><span class="popover-eyebrow">A SPACE FOR A FRAGMENT</span><h2>Paste your Markdown</h2></div><button class="icon-button" value="cancel" aria-label="Close paste dialog">${icon('close')}</button></div><label class="sr-only" for="paste-content">Markdown to preview</label><textarea id="paste-content" placeholder="# Something worth reading\n\nPaste your Markdown here…" spellcheck="false"></textarea><div class="dialog-actions"><span>Preview a document in Folio</span><button value="cancel" class="quiet-button">Cancel</button><button id="paste-submit" type="button" class="primary-button">Open preview ${icon('arrow')}</button></div></form></dialog>
    <dialog id="help-dialog" class="folio-dialog help-dialog"><form method="dialog"><div class="dialog-heading"><div><span class="popover-eyebrow">A LITTLE GUIDANCE</span><h2>At home in Folio</h2></div><button class="icon-button" aria-label="Close help">${icon('close')}</button></div><div class="help-body"><p>A standalone reader for CommonMark, GitHub Markdown, Obsidian notes, and extended Markdown.</p><div class="shortcut-row"><span>Open a document</span><kbd>Ctrl O</kbd></div><div class="shortcut-row"><span>Find in the document</span><kbd>Ctrl F</kbd></div><div class="shortcut-row"><span>Next / previous search match</span><span><kbd>Enter</kbd> / <kbd>Shift Enter</kbd></span></div><div class="shortcut-row"><span>Close a panel or search</span><kbd>Esc</kbd></div><h3>When a document looks different</h3><p>Try its matching format in the toolbar. Dialects can interpret the same syntax differently; document details show supported features and compatibility notes.</p><p>Executable content such as MDX components and notebook code needs its original runtime. Folio displays the readable content and surfaces detected limitations.</p><p class="help-version">FOLIO <span>·</span> Markdown, clearly.</p></div><div class="dialog-actions"><button class="primary-button">Back to reading ${icon('arrow')}</button></div></form></dialog>
  </div>`;

document.querySelectorAll('[id]').forEach(element => uiElements.set(element.id, element));
const article = byId('document-content');
const reader = byId('reader-scroll');

function persist() {
  try { localStorage.setItem('folio.settings', JSON.stringify(Object.fromEntries(Object.keys(defaults).map(key => [key, state[key]])))); } catch { /* Reading still works when storage is unavailable. */ }
}

function applySettings() {
  document.documentElement.dataset.theme = state.theme;
  byId('app-shell').dataset.view = state.view;
  byId('app-shell').classList.toggle('sidebar-hidden', !state.sidebar);
  byId('sidebar-toggle').setAttribute('aria-expanded', String(state.sidebar));
  document.documentElement.style.setProperty('--document-font-size', `${state.fontSize}px`);
  byId('font-size').value = state.fontSize;
  byId('font-size-value').textContent = `${state.fontSize} px`;
  byId('line-breaks').checked = state.breaks;
  byId('remote-images').checked = state.remoteImages;
  byId('profile-select').value = state.profile;
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === state.view)));
  byId('theme-toggle').innerHTML = icon(state.theme === 'dark' ? 'sun' : 'moon');
  const themeLabel = `Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme`;
  byId('theme-toggle').title = themeLabel;
  byId('theme-toggle').setAttribute('aria-label', themeLabel);
}

function notify(message, isError = false) {
  const toast = byId('toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { toast.hidden = true; }, isError ? 7000 : 4200);
}

function setStatus(message, busy = false) {
  byId('status-message').textContent = message;
  byId('status-dot').classList.toggle('busy', busy);
}

function togglePopover(id, triggerId, force) {
  const panel = byId(id);
  const show = force ?? panel.hidden;
  for (const [otherId, otherTrigger] of [['export-menu', 'export-toggle'], ['settings-panel', 'settings-toggle']]) {
    byId(otherId).hidden = true;
    byId(otherTrigger).setAttribute('aria-expanded', 'false');
  }
  panel.hidden = !show;
  byId(triggerId).setAttribute('aria-expanded', String(show));
}

function closePanels() {
  for (const [id, trigger] of [['export-menu', 'export-toggle'], ['settings-panel', 'settings-toggle'], ['details-panel', 'compatibility-toggle']]) {
    byId(id).hidden = true;
    byId(trigger).setAttribute('aria-expanded', 'false');
  }
}

function setView(view) {
  state.view = view;
  applySettings();
  persist();
  if (view === 'source') byId('source-content').focus();
}

function updateDetails() {
  const result = state.result;
  if (!result) return;
  const selected = profiles.find(profile => profile.id === state.profile);
  const metadata = Object.entries(result.metadata || {});
  byId('details-content').innerHTML = `
    <div class="detail-group"><span class="detail-label">INTERPRETATION</span><h3>${escapeHtml(selected?.label || state.profile)}</h3><p>${escapeHtml(selected?.description || 'A broad selection of Markdown extensions.')}</p></div>
    <div class="detail-group"><span class="detail-label">DOCUMENT</span><dl class="document-facts"><dt>Name</dt><dd>${escapeHtml(state.doc.name)}</dd><dt>Encoding</dt><dd>${escapeHtml(state.doc.encoding || 'UTF-8')}</dd><dt>Words</dt><dd>${Number(result.stats?.words || 0).toLocaleString()}</dd><dt>Characters</dt><dd>${Number(result.stats?.characters || 0).toLocaleString()}</dd>${state.doc.path ? `<dt>Location</dt><dd class="detail-path">${escapeHtml(state.doc.path)}</dd>` : '<dt>Location</dt><dd>In-memory preview</dd>'}</dl></div>
    ${metadata.length ? `<div class="detail-group"><span class="detail-label">FRONT MATTER</span><dl class="document-facts metadata-facts">${metadata.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : value)}</dd>`).join('')}</dl></div>` : ''}
    <div class="detail-group"><span class="detail-label">COMPATIBILITY</span>${state.warnings.length ? state.warnings.map(warning => `<div class="compatibility-note"><span class="note-dot"></span><p>${escapeHtml(warning.message || warning)}</p></div>`).join('') : `<div class="compatibility-clear">${icon('check')}<span>No compatibility issues detected.</span></div><p class="detail-small">Rendering can vary between applications. Select a specific format for a closer match.</p>`}</div>`;
  byId('warning-count').hidden = !state.warnings.length;
  byId('warning-count').textContent = state.warnings.length;
}

function updateOutline(headings) {
  headingObserver?.disconnect();
  const links = headings.map(heading => `<a href="#${encodeURIComponent(heading.id)}" class="outline-link level-${Math.min(heading.level, 6)}" data-heading-id="${escapeHtml(heading.id)}" title="${escapeHtml(heading.text)}"><span>${escapeHtml(heading.text)}</span></a>`).join('');
  byId('outline').innerHTML = links || '<p class="sidebar-empty">Headings will appear here.</p>';
  const items = [...byId('outline').querySelectorAll('a')];
  items[0]?.classList.add('active');
  headingObserver = new IntersectionObserver(entries => {
    const entry = entries.filter(item => item.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!entry) return;
    items.forEach(item => item.classList.toggle('active', item.dataset.headingId === entry.target.id));
  }, { root: reader, rootMargin: '-10px 0px -72% 0px', threshold: 0 });
  article.querySelectorAll('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]').forEach(heading => headingObserver.observe(heading));
}

function resolveAssets() {
  article.querySelectorAll('.code-block').forEach(block => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.title = 'Copy code';
    button.setAttribute('aria-label', 'Copy code');
    button.innerHTML = icon('copy');
    block.append(button);
  });
  if (!state.doc.baseUrl) return;
  article.querySelectorAll('img[src],source[src],video[src],audio[src]').forEach(element => {
    const src = element.getAttribute('src');
    if (!src || /^[a-z][a-z\d+.-]*:|^\/\//i.test(src) || src.startsWith('#')) return;
    try { element.src = new URL(src, state.doc.baseUrl).href; } catch { /* Keep original for a visible broken-resource indication. */ }
  });
}

async function renderCurrent({ preserveScroll = false } = {}) {
  const generation = ++renderGeneration;
  const oldScroll = reader.scrollTop;
  setStatus('Preparing your document…', true);
  try {
    const result = await renderMarkdown(state.doc.content, { profile: state.profile, breaks: state.breaks });
    if (generation !== renderGeneration) return;
    state.result = result;
    state.warnings = [...(result.warnings || [])];
    if (String(state.doc.encoding || '').includes('(fallback)')) {
      state.warnings.push({ code: 'encoding-fallback', message: 'This file is not valid UTF-8, so Folio read it as Windows-1252. Check accented characters if the document was created with a different encoding.' });
    }
    article.innerHTML = result.html;
    article.dataset.theme = state.theme;
    byId('source-content').value = state.doc.content;
    byId('document-title').textContent = state.doc.name;
    byId('document-title').title = state.doc.path || state.doc.name;
    document.title = `${state.doc.name} · Folio`;
    byId('document-location').textContent = state.doc === demoDocument ? 'YOUR READING SPACE' : state.doc.path ? 'LOCAL DOCUMENT' : 'PASTED DOCUMENT';
    byId('kicker-label').textContent = state.doc === demoDocument ? 'THE FOLIO FIELD GUIDE' : 'A MOMENT TO READ';
    byId('word-count').textContent = `${Number(result.stats?.words || 0).toLocaleString()} words`;
    byId('reading-time').textContent = `${Math.max(1, Number(result.stats?.readingMinutes) || 1)} min read`;
    byId('format-status').textContent = profileLabel(state.profile);
    resolveAssets();
    updateOutline(result.headings || []);
    updateDetails();
    reader.scrollTop = preserveScroll ? oldScroll : 0;
    const hydration = await hydrateDiagrams(article, { theme: state.theme });
    if (generation !== renderGeneration) return;
    state.warnings.push(...(hydration?.warnings || []));
    state.warnings = state.warnings.filter((warning, index, all) => all.findIndex(item => item.code === warning.code && item.message === warning.message) === index);
    updateDetails();
    if (!byId('search-bar').hidden) runSearch();
    setStatus(state.warnings.length ? `${state.warnings.length} compatibility ${state.warnings.length === 1 ? 'note' : 'notes'}` : 'Ready to read');
  } catch (error) {
    if (generation !== renderGeneration) return;
    setStatus('This document could not be rendered');
    article.innerHTML = `<div class="render-error"><h1>A small interruption.</h1><p>${escapeHtml(error.message || error)}</p><p>You can still inspect the Markdown in Source view.</p></div>`;
    byId('source-content').value = state.doc.content;
    notify(`Rendering failed: ${error.message || error}`, true);
  }
}

function render(options) {
  renderPromise = renderCurrent(options);
  return renderPromise;
}

async function refreshRecent() {
  if (!bridge?.getRecent) {
    byId('recent-files').innerHTML = '<p class="sidebar-empty">Your recently opened files<br/>will find a home here.</p>';
    return;
  }
  try {
    state.recent = await bridge.getRecent() || [];
    byId('recent-files').innerHTML = state.recent.length ? state.recent.slice(0, 8).map((file, index) => `<button class="recent-file${file.path === state.doc.path ? ' current' : ''}" data-recent="${index}" title="${escapeHtml(file.path)}">${icon('file')}<span>${escapeHtml(file.name || file.path.split(/[\\/]/).pop())}</span></button>`).join('') : '<p class="sidebar-empty">Your recently opened files<br/>will find a home here.</p>';
  } catch { byId('recent-files').innerHTML = '<p class="sidebar-empty">Recent files are unavailable.</p>'; }
}

async function acceptDocument(doc, { reload = false } = {}) {
  if (!doc || typeof doc.content !== 'string') return;
  const sameDocument = Boolean(state.doc.path && state.doc.path === doc.path);
  state.doc = doc;
  byId('file-modified').classList.toggle('visible', reload || sameDocument);
  await render({ preserveScroll: reload || sameDocument });
  await refreshRecent();
  if (reload) notify('Document updated from disk.');
  if (window.innerWidth < 900) { state.sidebar = false; applySettings(); }
}

async function openFile() {
  closePanels();
  if (!bridge?.openFile) { byId('file-input').click(); return; }
  try {
    const doc = await bridge.openFile();
    if (doc) await acceptDocument(doc);
  } catch (error) { notify(`Could not open the document: ${error.message || error}`, true); }
}

async function acceptDroppedFile(file) {
  try {
    if (bridge?.readDroppedFile) {
      const doc = await bridge.readDroppedFile(file);
      if (doc) { await acceptDocument(doc); return; }
    }
    if (file.size > 30 * 1024 * 1024) throw new Error('This file is too large for the browser preview (30 MB limit).');
    await acceptDocument({ name: file.name, path: null, baseUrl: null, content: await file.text() });
  } catch (error) { notify(`Could not open the document: ${error.message || error}`, true); }
}

function openPaste() {
  closePanels();
  byId('paste-dialog').showModal();
  byId('paste-content').focus();
}

function clearSearchMarks() {
  article.querySelectorAll('mark.folio-search-match').forEach(mark => mark.replaceWith(document.createTextNode(mark.textContent)));
  article.normalize();
  state.searchMarks = [];
  state.searchIndex = -1;
}

function runSearch() {
  clearSearchMarks();
  const query = byId('search-input').value.trim();
  if (!query) { byId('search-count').textContent = ''; return; }
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, { acceptNode(node) {
    if (!node.textContent.trim() || node.parentElement.closest('svg, .katex, script, style, .folio-search-match')) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  } });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const needle = query.toLocaleLowerCase();
  for (const node of nodes) {
    const value = node.textContent;
    const haystack = value.toLocaleLowerCase();
    let offset = 0;
    let match = haystack.indexOf(needle);
    if (match === -1) continue;
    const fragment = document.createDocumentFragment();
    while (match !== -1) {
      fragment.append(value.slice(offset, match));
      const mark = document.createElement('mark');
      mark.className = 'folio-search-match';
      mark.textContent = value.slice(match, match + query.length);
      fragment.append(mark);
      state.searchMarks.push(mark);
      offset = match + query.length;
      match = haystack.indexOf(needle, offset);
    }
    fragment.append(value.slice(offset));
    node.replaceWith(fragment);
  }
  if (state.searchMarks.length) moveSearch(1);
  else byId('search-count').textContent = 'No matches';
}

function moveSearch(direction) {
  if (!state.searchMarks.length) return;
  state.searchMarks[state.searchIndex]?.classList.remove('current');
  state.searchIndex = (state.searchIndex + direction + state.searchMarks.length) % state.searchMarks.length;
  const current = state.searchMarks[state.searchIndex];
  current.classList.add('current');
  let ancestor = current.parentElement;
  while (ancestor && ancestor !== article) {
    if (ancestor.tagName === 'DETAILS') ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
  current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  byId('search-count').textContent = `${state.searchIndex + 1} / ${state.searchMarks.length}`;
}

function toggleSearch(force) {
  const show = force ?? byId('search-bar').hidden;
  byId('search-bar').hidden = !show;
  if (show) {
    if (state.view === 'source') setView('split');
    byId('search-input').focus();
    byId('search-input').select();
  } else clearSearchMarks();
}

async function exportDocument(format) {
  if (state.exporting) return;
  state.exporting = true;
  closePanels();
  const buttons = [byId('export-toggle'), byId('export-html'), byId('export-pdf')];
  buttons.forEach(button => { button.disabled = true; });
  setStatus(`Preparing ${format.toUpperCase()} export…`, true);
  try {
    await renderPromise;
    const title = String(state.result?.metadata?.title || state.doc.name.replace(/\.[^.]+$/, ''));
    const exportArticle = article.cloneNode(true);
    exportArticle.querySelectorAll('.code-copy').forEach(button => button.remove());
    exportArticle.querySelectorAll('mark.folio-search-match').forEach(mark => mark.replaceWith(document.createTextNode(mark.textContent)));
    const html = await buildStandaloneHtml(exportArticle, { title, theme: state.theme, baseUrl: state.doc.baseUrl });
    if (bridge?.exportFile) {
      const result = await bridge.exportFile({ format, html, title });
      if (!result?.canceled) notify(`${format.toUpperCase()} saved${result?.path ? ` to ${result.path}` : '.'}`);
    } else if (format === 'html') {
      const href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = href;
      link.download = `${title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')}.html`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      notify('Your standalone HTML is ready.');
    } else {
      const printWindow = window.open('', '_blank');
      if (!printWindow) throw new Error('Allow this preview to open a print window, or use the desktop app for PDF export.');
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      await printWindow.document.fonts.ready;
      printWindow.focus();
      printWindow.print();
    }
  } catch (error) { notify(`Export failed: ${error.message || error}`, true); }
  finally {
    state.exporting = false;
    buttons.forEach(button => { button.disabled = false; });
    setStatus('Ready to read');
  }
}

byId('open-file').addEventListener('click', openFile);
byId('paste-open').addEventListener('click', openPaste);
byId('source-paste').addEventListener('click', openPaste);
byId('file-input').addEventListener('change', event => { const file = event.target.files?.[0]; if (file) acceptDroppedFile(file); event.target.value = ''; });
byId('welcome-button').addEventListener('click', () => acceptDocument(demoDocument));
byId('help-button').addEventListener('click', () => byId('help-dialog').showModal());
byId('paste-submit').addEventListener('click', () => {
  const content = byId('paste-content').value;
  if (!content.trim()) { byId('paste-content').focus(); return; }
  byId('paste-dialog').close();
  acceptDocument({ name: 'Pasted document.md', path: null, baseUrl: null, content });
});
byId('sidebar-toggle').addEventListener('click', () => { state.sidebar = !state.sidebar; applySettings(); persist(); });
byId('sidebar-scrim').addEventListener('click', () => { state.sidebar = false; applySettings(); });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
byId('profile-select').addEventListener('change', event => { state.profile = event.target.value; persist(); render({ preserveScroll: true }); });
byId('theme-toggle').addEventListener('click', () => { state.theme = state.theme === 'light' ? 'dark' : 'light'; applySettings(); persist(); render({ preserveScroll: true }); });
byId('settings-toggle').addEventListener('click', () => togglePopover('settings-panel', 'settings-toggle'));
byId('export-toggle').addEventListener('click', () => togglePopover('export-menu', 'export-toggle'));
byId('font-size').addEventListener('input', event => { state.fontSize = Number(event.target.value); applySettings(); persist(); });
byId('line-breaks').addEventListener('change', event => { state.breaks = event.target.checked; persist(); render({ preserveScroll: true }); });
byId('remote-images').addEventListener('change', async event => {
  state.remoteImages = event.target.checked;
  try { await bridge?.setRemoteImages?.(state.remoteImages); persist(); render({ preserveScroll: true }); }
  catch (error) { state.remoteImages = !state.remoteImages; applySettings(); notify(`Could not change image loading: ${error.message || error}`, true); }
});
byId('compatibility-toggle').addEventListener('click', () => { const panel = byId('details-panel'); panel.hidden = !panel.hidden; byId('compatibility-toggle').setAttribute('aria-expanded', String(!panel.hidden)); });
byId('details-close').addEventListener('click', () => { byId('details-panel').hidden = true; byId('compatibility-toggle').setAttribute('aria-expanded', 'false'); byId('compatibility-toggle').focus(); });
byId('export-html').addEventListener('click', () => exportDocument('html'));
byId('export-pdf').addEventListener('click', () => exportDocument('pdf'));
const copyText = text => bridge?.copyText ? bridge.copyText(text) : navigator.clipboard.writeText(text);
byId('copy-source').addEventListener('click', async () => { try { await copyText(state.doc.content); notify('Markdown copied to clipboard.'); } catch { byId('source-content').select(); notify('Select and copy the source with Ctrl+C.'); } });
byId('search-toggle').addEventListener('click', () => toggleSearch());
byId('search-close').addEventListener('click', () => toggleSearch(false));
byId('search-input').addEventListener('input', runSearch);
byId('search-input').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); moveSearch(event.shiftKey ? -1 : 1); } });
byId('search-prev').addEventListener('click', () => moveSearch(-1));
byId('search-next').addEventListener('click', () => moveSearch(1));
byId('recent-files').addEventListener('click', async event => {
  const button = event.target.closest('[data-recent]');
  if (!button) return;
  try { const doc = await bridge.openRecent(state.recent[Number(button.dataset.recent)].path); if (doc) await acceptDocument(doc); }
  catch (error) { notify(`Could not reopen the document: ${error.message || error}`, true); }
});

function scrollToHeading(id) {
  const heading = article.querySelector(`[id="${CSS.escape(id)}"]`);
  if (!heading) return false;
  if (state.view === 'source') setView('read');
  heading.scrollIntoView({ block: 'start', behavior: 'smooth' });
  if (window.innerWidth < 900) { state.sidebar = false; applySettings(); }
  return true;
}

byId('outline').addEventListener('click', event => {
  const link = event.target.closest('a[data-heading-id]');
  if (!link) return;
  event.preventDefault();
  scrollToHeading(link.dataset.headingId);
});
article.addEventListener('click', async event => {
  const copyButton = event.target.closest('.code-copy');
  if (copyButton) {
    const code = copyButton.closest('.code-block')?.querySelector('pre code')?.textContent;
    try { await copyText(code || ''); notify('Code copied to clipboard.'); }
    catch { notify('Clipboard access is unavailable. Select the code and press Ctrl+C.'); }
    return;
  }
  const anchor = event.target.closest('a[href]');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (href.startsWith('#')) {
    event.preventDefault();
    try { scrollToHeading(decodeURIComponent(href.slice(1))); } catch { /* Malformed anchors remain inert. */ }
    return;
  }
  event.preventDefault();
  if (bridge?.openLink) {
    try {
      const doc = await bridge.openLink({ href, fromPath: state.doc.path });
      if (doc) {
        await acceptDocument(doc);
        const fragment = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
        if (fragment) {
          const decoded = decodeURIComponent(fragment);
          if (!scrollToHeading(decoded)) scrollToHeading(decoded.toLocaleLowerCase().replace(/\s+/g, '-'));
        }
      }
    }
    catch (error) { notify(`Could not open this link: ${error.message || error}`, true); }
  } else if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
  else notify('Open this document in the desktop app to follow local file links.');
});

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); openFile(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); toggleSearch(true); }
  else if (event.key === 'Escape') { closePanels(); toggleSearch(false); if (window.innerWidth < 900) { state.sidebar = false; applySettings(); } }
});
document.addEventListener('click', event => {
  if (!event.target.closest('#export-menu, #export-toggle')) { byId('export-menu').hidden = true; byId('export-toggle').setAttribute('aria-expanded', 'false'); }
  if (!event.target.closest('#settings-panel, #settings-toggle')) { byId('settings-panel').hidden = true; byId('settings-toggle').setAttribute('aria-expanded', 'false'); }
});
document.addEventListener('dragenter', event => {
  if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
  event.preventDefault();
  dragDepth += 1;
  byId('drop-overlay').hidden = false;
});
document.addEventListener('dragover', event => { if ([...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault(); });
document.addEventListener('dragleave', event => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) byId('drop-overlay').hidden = true; });
document.addEventListener('drop', event => {
  event.preventDefault();
  dragDepth = 0;
  byId('drop-overlay').hidden = true;
  const file = event.dataTransfer?.files?.[0];
  if (file) acceptDroppedFile(file);
});
window.addEventListener('blur', () => { dragDepth = 0; byId('drop-overlay').hidden = true; });

bridge?.onDocument?.(doc => {
  const actual = doc?.document || doc;
  acceptDocument(actual, { reload: Boolean(state.doc.path && state.doc.path === actual?.path) });
});
bridge?.onCommand?.(command => {
  const action = typeof command === 'string' ? command : command?.command;
  if (action === 'open' || action === 'open-file') openFile();
  else if (action === 'find' || action === 'search') toggleSearch(true);
  else if (action === 'export-html') exportDocument('html');
  else if (action === 'export-pdf') exportDocument('pdf');
  else if (action === 'paste') openPaste();
  else if (action === 'help') byId('help-dialog').showModal();
  else if (['read', 'split', 'source'].includes(action)) setView(action);
});

async function initialize() {
  if (window.innerWidth < 900) state.sidebar = false;
  applySettings();
  try { await bridge?.setRemoteImages?.(Boolean(state.remoteImages)); } catch { /* Local document reading remains available. */ }
  await render();
  await refreshRecent();
  try {
    const initial = await bridge?.getInitialDocument?.();
    if (initial) await acceptDocument(initial);
  } catch (error) { notify(`Could not open the initial document: ${error.message || error}`, true); }
}
initialize();
