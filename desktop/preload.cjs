const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('yingyuDesktop', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  close: () => ipcRenderer.invoke('window:close'),
  hide: () => ipcRenderer.invoke('window:hide'),
  quit: () => ipcRenderer.invoke('app:quit'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  openWeb: (url) => ipcRenderer.invoke('window:open-web', url),
  onMaximizeChange: (callback) => {
    ipcRenderer.on('window:maximized', (_event, value) => callback(value))
  },
  setCloseBehavior: (prefs) => ipcRenderer.send('close-behavior:set', prefs),
  onCloseAsk: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('close:ask', handler)
    return () => ipcRenderer.removeListener('close:ask', handler)
  },
})
