const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  hasApiKey: () => ipcRenderer.invoke('has-api-key'),
  getApiKeyStatus: () => ipcRenderer.invoke('get-api-key-status'),
  saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),
  resetApiKey: () => ipcRenderer.invoke('reset-api-key'),
  analyzeImage: (imageBase64, mimeType) =>
    ipcRenderer.invoke('analyze-image', { imageBase64, mimeType }),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getHistory: () => ipcRenderer.invoke('get-history'),
  getHistoryItem: (id) => ipcRenderer.invoke('get-history-item', id),
});
