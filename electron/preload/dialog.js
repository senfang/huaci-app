const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('huaci', {
  onOpen(callback) {
    ipcRenderer.on('dialog:open', (_e, payload) => callback(payload));
  },
  onEvent(callback) {
    ipcRenderer.on('dialog:event', (_e, payload) => callback(payload));
  },
  run(text, profileId) {
    ipcRenderer.send('dialog:run', { text, profileId });
  },
  abort() {
    ipcRenderer.send('dialog:abort');
  },
  close() {
    ipcRenderer.send('dialog:close');
  },
});
