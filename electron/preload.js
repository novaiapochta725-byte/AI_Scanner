const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronBridge', {
  exportLegacyApiKey: () => ipcRenderer.invoke('export-legacy-api-key'),
});

contextBridge.exposeInMainWorld('api', {
  isElectron: true,
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
