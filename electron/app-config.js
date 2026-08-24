const Store = require('electron-store');
const { v4: uuidv4 } = require('uuid');

const store = new Store({
  name: 'huaci-config',
  defaults: {
    apiProfiles: [
      {
        id: 'default',
        name: '默认接口',
        url: '',
      },
    ],
    toolbarButtons: [
      {
        id: 'btn-ai',
        label: 'AI 解读',
        icon: '✨',
        type: 'api',
        apiProfileId: 'default',
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
    selectionMaxLength: 50000,
    launchAtLogin: false,
    settingsShortcut: 'Control+]',
  },
});

function normalizeSettingsShortcut(value) {
  const legacyMap = {
    'Control+Backslash': 'Control+]',
  };
  if (legacyMap[value]) return legacyMap[value];
  return value || 'Control+]';
}

function normalizeSelectionMaxLength(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return 50000;
  return Math.min(n, 500000);
}

function migrateStoredConfig() {
  const legacyProfiles = store.get('difyProfiles');
  if (!store.get('apiProfiles') && Array.isArray(legacyProfiles)) {
    store.set(
      'apiProfiles',
      legacyProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name || '未命名接口',
        url: profile.url || '',
      }))
    );
    store.delete('difyProfiles');
  }

  const buttons = store.get('toolbarButtons') || [];
  let changed = false;
  const migratedButtons = buttons.map((button) => {
    const next = { ...button };
    if (button.type === 'dify') {
      next.type = 'api';
      changed = true;
    }
    if (button.difyProfileId && !button.apiProfileId) {
      next.apiProfileId = button.difyProfileId;
      delete next.difyProfileId;
      changed = true;
    }
    return next;
  });
  if (changed) {
    store.set('toolbarButtons', migratedButtons);
  }
}

function getConfig() {
  migrateStoredConfig();

  const data = store.store;
  const normalized = normalizeSettingsShortcut(data.settingsShortcut);
  if (normalized !== data.settingsShortcut) {
    store.set('settingsShortcut', normalized);
    data.settingsShortcut = normalized;
  }
  const maxLen = normalizeSelectionMaxLength(data.selectionMaxLength);
  if (maxLen !== data.selectionMaxLength) {
    store.set('selectionMaxLength', maxLen);
    data.selectionMaxLength = maxLen;
  }
  return data;
}

function getEnabledToolbarButtons() {
  return (store.get('toolbarButtons') || []).filter((b) => b.enabled);
}

function getApiProfile(id) {
  return (store.get('apiProfiles') || []).find((p) => p.id === id);
}

function saveConfig(partial) {
  if ('selectionMaxLength' in partial) {
    partial.selectionMaxLength = normalizeSelectionMaxLength(partial.selectionMaxLength);
  }
  if ('difyProfiles' in partial && !('apiProfiles' in partial)) {
    partial.apiProfiles = partial.difyProfiles.map((profile) => ({
      id: profile.id,
      name: profile.name || '未命名接口',
      url: profile.url || profile.apiBaseUrl || '',
    }));
    delete partial.difyProfiles;
  }
  if (Array.isArray(partial.toolbarButtons)) {
    partial.toolbarButtons = partial.toolbarButtons.map((button) => ({
      ...button,
      type: button.type === 'dify' ? 'api' : button.type,
      apiProfileId: button.apiProfileId || button.difyProfileId || null,
      difyProfileId: undefined,
    }));
  }
  for (const [key, value] of Object.entries(partial)) {
    store.set(key, value);
  }
  return getConfig();
}

function addApiProfile(profile) {
  const profiles = store.get('apiProfiles') || [];
  const item = {
    id: uuidv4(),
    name: profile.name || '新接口',
    url: profile.url || '',
  };
  profiles.push(item);
  store.set('apiProfiles', profiles);
  return item;
}

function updateApiProfile(id, updates) {
  const profiles = store.get('apiProfiles') || [];
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  profiles[idx] = { ...profiles[idx], ...updates, id };
  store.set('apiProfiles', profiles);
  return profiles[idx];
}

function deleteApiProfile(id) {
  let profiles = store.get('apiProfiles') || [];
  profiles = profiles.filter((p) => p.id !== id);
  store.set('apiProfiles', profiles);

  const buttons = (store.get('toolbarButtons') || []).map((b) => {
    if ((b.type === 'api' || b.type === 'dify') && b.apiProfileId === id) {
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
    type: button.type === 'dify' ? 'api' : button.type || 'api',
    apiProfileId: button.apiProfileId || button.difyProfileId || null,
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
  getApiProfile,
  saveConfig,
  addApiProfile,
  updateApiProfile,
  deleteApiProfile,
  addToolbarButton,
  updateToolbarButton,
  deleteToolbarButton,
  reorderToolbarButtons,
  normalizeSelectionMaxLength,
};
