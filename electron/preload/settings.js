const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('huaci', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (partial) => ipcRenderer.invoke('config:save', partial),
  addProfile: (profile) => ipcRenderer.invoke('config:addProfile', profile),
  updateProfile: (id, updates) => ipcRenderer.invoke('config:updateProfile', id, updates),
  deleteProfile: (id) => ipcRenderer.invoke('config:deleteProfile', id),
  addButton: (button) => ipcRenderer.invoke('config:addButton', button),
  updateButton: (id, updates) => ipcRenderer.invoke('config:updateButton', id, updates),
  deleteButton: (id) => ipcRenderer.invoke('config:deleteButton', id),
  reorderButtons: (ids) => ipcRenderer.invoke('config:reorderButtons', ids),
  checkAccessibility: () => ipcRenderer.invoke('app:checkAccessibility'),
  openAccessibilitySettings: () => ipcRenderer.send('app:openAccessibilitySettings'),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('app:setLaunchAtLogin', enabled),
  getLaunchAtLogin: () => ipcRenderer.invoke('app:getLaunchAtLogin'),
  registerSettingsShortcut: (accelerator) => ipcRenderer.invoke('app:registerSettingsShortcut', accelerator),
});
