const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('huaci', {
  onShow(callback) {
    ipcRenderer.on('toolbar:show', (_e, payload) => callback(payload));
  },
  action(buttonId, action, text) {
    ipcRenderer.send('toolbar:action', { buttonId, action, text });
  },
  hide() {
    ipcRenderer.send('toolbar:hide');
  },
  resize(width, height) {
    ipcRenderer.send('toolbar:resize', { width, height });
  },
});
