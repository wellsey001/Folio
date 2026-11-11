// The only bridge between the page and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('folio', {
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  getInitialFiles: () => ipcRenderer.invoke('app:initial-files'),
  onOpenFiles: (callback) => ipcRenderer.on('files:open', (_event, files) => callback(files)),
  setTheme: (mode) => ipcRenderer.invoke('app:set-theme', mode),
  toggleDevTools: () => ipcRenderer.send('app:toggle-devtools'),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
});
