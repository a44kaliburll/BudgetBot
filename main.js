const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const DataStore = require('./store');

let mainWindow = null;
let store = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 660,
    backgroundColor: '#0d0d0d',
    show: false,
    autoHideMenuBar: true,
    title: 'NestEgg',
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // External links open in the system browser, never in-app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  store = new DataStore(app.getPath('userData'));

  ipcMain.handle('data:load', () => store.load());
  ipcMain.handle('data:save', (_e, data) => store.save(data));
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataPath: store.filePath,
    platform: process.platform
  }));

  ipcMain.handle('file:export', async (_e, { defaultName, content, filterName, filterExt }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [{ name: filterName, extensions: [filterExt] }]
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(filePath, content, 'utf8');
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('file:import', async (_e, { filterName, filterExt }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import',
      properties: ['openFile'],
      filters: [{ name: filterName, extensions: filterExt }]
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true };
    try {
      const content = fs.readFileSync(filePaths[0], 'utf8');
      return { ok: true, filePath: filePaths[0], content };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // binary-safe import (PDF statements etc.) — returns base64
  ipcMain.handle('file:importAny', async (_e, { filterName, filterExt }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import',
      properties: ['openFile'],
      filters: [{ name: filterName, extensions: filterExt }]
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true };
    try {
      const buf = fs.readFileSync(filePaths[0]);
      return { ok: true, filePath: filePaths[0], base64: buf.toString('base64') };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('file:showDataFolder', () => {
    shell.showItemInFolder(store.filePath);
    return true;
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
