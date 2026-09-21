const { contextBridge, ipcRenderer, webUtils } = require('electron');
const subscribe = (channel, callback) => {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('folio', Object.freeze({
  openFile: () => ipcRenderer.invoke('folio:open'),
  saveDocument: (saveAs = false) => ipcRenderer.invoke('folio:save', saveAs),
  setDraft: (draft) => ipcRenderer.send('folio:draft', draft),
  replaceWithMemoryDocument: (doc) => ipcRenderer.invoke('folio:memory-document', doc),
  onBusy: (callback) => subscribe('folio:busy', callback),
  onConflict: (callback) => subscribe('folio:conflict', callback),
  openRecent: (filePath) => ipcRenderer.invoke('folio:recent-open', filePath),
  openLink: (link) => ipcRenderer.invoke('folio:link', link),
  getRecent: () => ipcRenderer.invoke('folio:recent'),
  getInitialDocument: () => ipcRenderer.invoke('folio:initial'),
  exportFile: (options) => ipcRenderer.invoke('folio:export', options),
  embedResource: (url) => ipcRenderer.invoke('folio:embed', url),
  setRemoteImages: (enabled) => ipcRenderer.invoke('folio:remote-images', enabled),
  copyText: (text) => ipcRenderer.invoke('folio:copy', text),
  readDroppedFile: (file) => ipcRenderer.invoke('folio:drop', webUtils.getPathForFile(file)),
  onDocument: (callback) => subscribe('folio:document', callback),
  onCommand: (callback) => subscribe('folio:command', callback)
}));
