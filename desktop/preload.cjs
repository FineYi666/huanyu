const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('yingyuDesktop', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizeChange: (callback) => {
    ipcRenderer.on('window:maximized', (_event, value) => callback(value))
  },
})
