const Store = require('electron-store');
const { v4: uuidv4 } = require('uuid');

const store = new Store({
  name: 'huaci-config',
  defaults: {
    difyProfiles: [
      {
        id: 'default',
        name: '默认工作流',
        apiBaseUrl: 'https://dify.surspark.com/v1',
        apiKey: '',
        inputVariable: 'query',
        userId: 'huaci-app-user',
      },
    ],
    toolbarButtons: [
      {
        id: 'btn-ai',
        label: 'AI 解读',
        icon: '✨',
        type: 'dify',
        difyProfileId: 'default',
        enabled: true,
        primary: true,
      },
      {
        id: 'btn-copy',
        label: '复制',
        icon: '',
        type: 'copy',
        enabled: true,
        primary: false,
      },
    ],
    selectionEnabled: true,
    launchAtLogin: false,
  },
});

function getConfig() {
  return store.store;
}

function getEnabledToolbarButtons() {
  return (store.get('toolbarButtons') || []).filter((b) => b.enabled);
}

function getDifyProfile(id) {
  return (store.get('difyProfiles') || []).find((p) => p.id === id);
}

function saveConfig(partial) {
  for (const [key, value] of Object.entries(partial)) {
    store.set(key, value);
  }
  return getConfig();
}

function addDifyProfile(profile) {
  const profiles = store.get('difyProfiles') || [];
  const item = {
    id: uuidv4(),
    name: profile.name || '新工作流',
    apiBaseUrl: profile.apiBaseUrl || 'https://dify.surspark.com/v1',
    apiKey: profile.apiKey || '',
    inputVariable: profile.inputVariable || 'query',
    userId: profile.userId || 'huaci-app-user',
  };
  profiles.push(item);
  store.set('difyProfiles', profiles);
  return item;
}

function updateDifyProfile(id, updates) {
  const profiles = store.get('difyProfiles') || [];
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  profiles[idx] = { ...profiles[idx], ...updates, id };
  store.set('difyProfiles', profiles);
  return profiles[idx];
}

function deleteDifyProfile(id) {
  let profiles = store.get('difyProfiles') || [];
  profiles = profiles.filter((p) => p.id !== id);
  store.set('difyProfiles', profiles);

  const buttons = (store.get('toolbarButtons') || []).map((b) => {
    if (b.type === 'dify' && b.difyProfileId === id) {
      return { ...b, enabled: false };
    }
    return b;
  });
  store.set('toolbarButtons', buttons);
}

function addToolbarButton(button) {
  const buttons = store.get('toolbarButtons') || [];
  const item = {
    id: uuidv4(),
    label: button.label || '新按钮',
    icon: button.icon || '',
    type: button.type || 'dify',
    difyProfileId: button.difyProfileId || null,
    enabled: button.enabled !== false,
    primary: !!button.primary,
  };
  buttons.push(item);
  store.set('toolbarButtons', buttons);
  return item;
}

function updateToolbarButton(id, updates) {
  const buttons = store.get('toolbarButtons') || [];
  const idx = buttons.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  buttons[idx] = { ...buttons[idx], ...updates, id };
  store.set('toolbarButtons', buttons);
  return buttons[idx];
}

function deleteToolbarButton(id) {
  const buttons = (store.get('toolbarButtons') || []).filter((b) => b.id !== id);
  store.set('toolbarButtons', buttons);
}

function reorderToolbarButtons(orderedIds) {
  const buttons = store.get('toolbarButtons') || [];
  const map = new Map(buttons.map((b) => [b.id, b]));
  const reordered = orderedIds.map((id) => map.get(id)).filter(Boolean);
  const rest = buttons.filter((b) => !orderedIds.includes(b.id));
  store.set('toolbarButtons', [...reordered, ...rest]);
}

module.exports = {
  getConfig,
  getEnabledToolbarButtons,
  getDifyProfile,
  saveConfig,
  addDifyProfile,
  updateDifyProfile,
  deleteDifyProfile,
  addToolbarButton,
  updateToolbarButton,
  deleteToolbarButton,
  reorderToolbarButtons,
};
