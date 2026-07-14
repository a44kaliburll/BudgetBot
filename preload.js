const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  appInfo: () => ipcRenderer.invoke('app:info'),
  exportFile: (opts) => ipcRenderer.invoke('file:export', opts),
  importFile: (opts) => ipcRenderer.invoke('file:import', opts),
  showDataFolder: () => ipcRenderer.invoke('file:showDataFolder')
});
