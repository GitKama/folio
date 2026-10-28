// A narrow bridge to Rust. Document HTML has no native APIs or independent windows.
if (window.__TAURI__) {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  // Preserve edit/save ordering even when Rust schedules requests on worker threads.
  let pending = Promise.resolve();
  const call = (action, payload = null) => {
    const result = pending.then(() => invoke('request', { action, payload }));
    pending = result.catch(() => {});
    return result;
  };
  const handlers = new Map();
  const subscribe = (event, callback) => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(callback);
    return () => handlers.get(event)?.delete(callback);
  };
  await listen('folio', ({ payload: { event, value } }) => handlers.get(event)?.forEach(fn => fn(value)));
  if (!localStorage.getItem('folio.settings')) {
    const saved = await call('preferences');
    if (saved && typeof saved === 'object') localStorage.setItem('folio.settings', JSON.stringify(saved));
  }
  window.folio = Object.freeze({
    openFile: () => call('open'), saveDocument: saveAs => call('save', Boolean(saveAs)),
    setDraft: draft => { call('draft', draft).catch(console.error); },
    replaceWithMemoryDocument: doc => call('memory', doc),
    openRecent: path => call('recent-open', path), openLink: link => call('link', link),
    getRecent: () => call('recent'), getInitialDocument: () => call('initial'),
    exportFile: options => call('export', options), embedResource: url => call('embed', url),
    setRemoteImages: enabled => call('remote-images', enabled),
    setPreferences: preferences => call('set-preferences', preferences),
    copyText: text => call('copy', text), copyTeams: payload => call('copy-teams', payload),
    closeDocument: draft => call('draft', draft).then(() => call('close')),
    onDocument: fn => subscribe('document', fn), onCommand: fn => subscribe('command', fn),
    onBusy: fn => subscribe('busy', fn), onConflict: fn => subscribe('conflict', fn),
  });
  await listen('tauri://drag-drop', ({ payload }) => call('drop', payload.paths?.[0]).catch(error => {
    const toast = document.getElementById('toast');
    if (toast) { toast.textContent = String(error); toast.hidden = false; }
  }));
}
