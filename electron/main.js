const fs = require('fs');
const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');
const storage = require('./services/storage');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 640,
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

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'audioCapture' || permission === 'microphone');
  });

  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media' || permission === 'audioCapture' || permission === 'microphone';
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('export-legacy-api-key', () => storage.getApiKey());

ipcMain.handle('open-external', (_event, url) => {
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error('Invalid URL');
  }
  return shell.openExternal(url);
});
