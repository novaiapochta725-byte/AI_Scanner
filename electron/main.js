const fs = require('fs');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const storage = require('./services/storage');
const gemini = require('./services/gemini');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: 'AI Product Scanner',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    autoHideMenuBar: true,
  });

  mainWindow.loadFile(
    fs.existsSync(path.join(__dirname, '../dist/index.html'))
      ? path.join(__dirname, '../dist/index.html')
      : path.join(__dirname, '../src/index.html')
  );
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('has-api-key', () => storage.hasApiKey());

ipcMain.handle('get-api-key-status', () => storage.getApiKeyStatus());

ipcMain.handle('save-api-key', (_event, apiKey) => {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
    throw new Error('Invalid API key');
  }
  storage.saveApiKey(apiKey.trim());
  return true;
});

ipcMain.handle('reset-api-key', () => {
  storage.resetApiKey();
  return true;
});

ipcMain.handle('analyze-image', async (_event, { imageBase64, mimeType }) => {
  const apiKey = storage.getApiKey();
  if (!apiKey) {
    throw new Error('API key not configured. Go to Settings → API.');
  }

  const result = await gemini.analyzeProduct(apiKey, imageBase64, mimeType);
  const entry = storage.addToHistory({ imageBase64, mimeType, result });
  return { result, historyId: entry.id };
});

ipcMain.handle('open-external', (_event, url) => {
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error('Invalid URL');
  }
  return shell.openExternal(url);
});

ipcMain.handle('get-history', () => storage.loadHistory());

ipcMain.handle('get-history-item', (_event, id) => storage.getHistoryItem(id));
