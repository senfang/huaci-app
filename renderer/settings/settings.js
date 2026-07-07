'use strict';

let config = { difyProfiles: [], toolbarButtons: [] };
let dragSrcId = null;

const buttonList = document.getElementById('buttonList');
const profileList = document.getElementById('profileList');
const buttonTpl = document.getElementById('buttonItemTpl');
const profileTpl = document.getElementById('profileItemTpl');

function formatAccelerator(accelerator) {
  if (!accelerator) return '';
  return accelerator
    .split('+')
    .map((part) => {
      if (part === 'Control') return 'Ctrl';
      if (part === 'CommandOrControl') return 'Ctrl/Cmd';
      if (part === 'Backslash') return '\\';
      if (part === 'Comma') return ',';
      return part;
    })
    .join(' + ');
}

function keyEventToAccelerator(e) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;

  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');

  if (!mods.length) return null;

  const keyMap = {
    '\\': 'Backslash',
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Esc',
  };

  let key = keyMap[e.key] || e.key;
  if (key.length === 1) key = key.toUpperCase();

  return [...mods, key].join('+');
}

function setupShortcutInput() {
  const input = document.getElementById('settingsShortcut');
  const errorEl = document.getElementById('shortcutError');
  let recording = false;

  input.addEventListener('focus', () => {
    recording = true;
    input.classList.add('recording');
    input.value = '请按下快捷键…';
    errorEl.style.display = 'none';
  });

  input.addEventListener('blur', () => {
    if (!recording) return;
    recording = false;
    input.classList.remove('recording');
    input.value = formatAccelerator(config.settingsShortcut || 'Control+]');
  });

  input.addEventListener('keydown', async (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      input.blur();
      return;
    }

    const accelerator = keyEventToAccelerator(e);
    if (!accelerator) return;

    const result = await window.huaci.registerSettingsShortcut(accelerator);
    if (!result.ok) {
      errorEl.textContent = `快捷键 ${formatAccelerator(accelerator)} 注册失败，可能被系统或其他应用占用`;
      errorEl.style.display = 'block';
      input.value = formatAccelerator(config.settingsShortcut || 'Control+]');
      recording = false;
      input.classList.remove('recording');
      input.blur();
      return;
    }

    config.settingsShortcut = accelerator;
    input.value = formatAccelerator(accelerator);
    recording = false;
    input.classList.remove('recording');
    errorEl.style.display = 'none';
    showToast();
    input.blur();
  });
}

function showToast() {
  const toast = document.getElementById('toast');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function profileOptionsHtml(selectedId) {
  const profiles = collectProfilesFromDom();
  const opts = profiles.map(
    (p) => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${escapeHtml(p.name || '未命名工作流')}</option>`
  );
  return opts.join('') || '<option value="">（请先添加工作流）</option>';
}

function collectProfilesFromDom() {
  return [...profileList.querySelectorAll('.profile-card')].map((card) => ({
    id: card.dataset.id,
    name: card.querySelector('.profile-name').value.trim() || '未命名工作流',
  }));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function refreshProfileSelects() {
  buttonList.querySelectorAll('.btn-profile').forEach((sel) => {
    const row = sel.closest('.item-row');
    const id = row?.dataset.id;
    const btn = config.toolbarButtons.find((b) => b.id === id);
    const current = btn?.difyProfileId || '';
    sel.innerHTML = profileOptionsHtml(current);
    sel.disabled = row?.querySelector('.btn-type')?.value === 'copy';
  });
}

function renderButtons() {
  buttonList.innerHTML = '';
  config.toolbarButtons.forEach((btn) => {
    const node = buttonTpl.content.cloneNode(true);
    const row = node.querySelector('.item-row');
    row.dataset.id = btn.id;

    row.querySelector('.btn-enabled').checked = btn.enabled !== false;
    row.querySelector('.btn-label').value = btn.label || '';
    row.querySelector('.btn-icon').value = btn.icon || '';
    row.querySelector('.btn-type').value = btn.type || 'dify';
    row.querySelector('.btn-primary').checked = !!btn.primary;
    row.querySelector('.btn-profile').innerHTML = profileOptionsHtml(btn.difyProfileId);
    row.querySelector('.btn-profile').disabled = btn.type === 'copy';

    row.querySelector('.btn-type').addEventListener('change', (e) => {
      row.querySelector('.btn-profile').disabled = e.target.value === 'copy';
    });

    row.querySelector('.btn-delete').addEventListener('click', () => {
      config.toolbarButtons = config.toolbarButtons.filter((b) => b.id !== btn.id);
      renderButtons();
    });

    row.addEventListener('dragstart', () => {
      dragSrcId = btn.id;
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => e.preventDefault());
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragSrcId || dragSrcId === btn.id) return;
      const ids = config.toolbarButtons.map((b) => b.id);
      const from = ids.indexOf(dragSrcId);
      const to = ids.indexOf(btn.id);
      ids.splice(from, 1);
      ids.splice(to, 0, dragSrcId);
      config.toolbarButtons = ids.map((id) => config.toolbarButtons.find((b) => b.id === id));
      dragSrcId = null;
      renderButtons();
    });

    buttonList.appendChild(node);
  });
}

function renderProfiles() {
  profileList.innerHTML = '';
  config.difyProfiles.forEach((profile) => {
    const node = profileTpl.content.cloneNode(true);
    const card = node.querySelector('.profile-card');
    card.dataset.id = profile.id;

    card.querySelector('.profile-name').value = profile.name || '';
    card.querySelector('.profile-apiBaseUrl').value = profile.apiBaseUrl || '';
    card.querySelector('.profile-apiKey').value = profile.apiKey || '';
    card.querySelector('.profile-inputVariable').value = profile.inputVariable || 'query';
    card.querySelector('.profile-userId').value = profile.userId || 'huaci-app-user';

    card.querySelector('.profile-name').addEventListener('input', () => {
      refreshProfileSelects();
    });

    card.querySelector('.btn-delete-profile').addEventListener('click', () => {
      if (!confirm(`确定删除工作流「${profile.name}」？`)) return;
      config.difyProfiles = config.difyProfiles.filter((p) => p.id !== profile.id);
      config.toolbarButtons.forEach((b) => {
        if (b.difyProfileId === profile.id) b.enabled = false;
      });
      renderProfiles();
      refreshProfileSelects();
    });

    profileList.appendChild(node);
  });
}

function collectFormData() {
  const profiles = [...profileList.querySelectorAll('.profile-card')].map((card) => ({
    id: card.dataset.id,
    name: card.querySelector('.profile-name').value.trim() || '未命名工作流',
    apiBaseUrl: card.querySelector('.profile-apiBaseUrl').value.trim() || 'https://dify.surspark.com/v1',
    apiKey: card.querySelector('.profile-apiKey').value.trim(),
    inputVariable: card.querySelector('.profile-inputVariable').value.trim() || 'query',
    userId: card.querySelector('.profile-userId').value.trim() || 'huaci-app-user',
  }));

  const buttons = [...buttonList.querySelectorAll('.item-row')].map((row) => ({
    id: row.dataset.id,
    label: row.querySelector('.btn-label').value.trim() || '按钮',
    icon: row.querySelector('.btn-icon').value.trim(),
    type: row.querySelector('.btn-type').value,
    difyProfileId: row.querySelector('.btn-profile').value || null,
    enabled: row.querySelector('.btn-enabled').checked,
    primary: row.querySelector('.btn-primary').checked,
  }));

  return {
    difyProfiles: profiles,
    toolbarButtons: buttons,
    launchAtLogin: document.getElementById('launchAtLogin').checked,
    selectionEnabled: document.getElementById('selectionEnabled').checked,
    selectionMaxLength: Number.parseInt(document.getElementById('selectionMaxLength').value, 10),
    settingsShortcut: config.settingsShortcut || 'Control+]',
  };
}

async function load() {
  config = await window.huaci.getConfig();
  document.getElementById('launchAtLogin').checked = !!config.launchAtLogin;
  document.getElementById('selectionEnabled').checked = config.selectionEnabled !== false;
  document.getElementById('selectionMaxLength').value = String(config.selectionMaxLength ?? 50000);
  document.getElementById('settingsShortcut').value = formatAccelerator(
    config.settingsShortcut || 'Control+]'
  );
  setupShortcutInput();
  renderProfiles();
  renderButtons();

  const access = await window.huaci.checkAccessibility();
  const launchHint = document.getElementById('launchAtLoginHint');
  const launchHints = {
    darwin: '登录 macOS 后自动在菜单栏运行，不弹出窗口',
    win32: '登录 Windows 后自动在系统托盘运行，不弹出窗口',
    linux: '登录后自动启动，在系统托盘运行，不弹出窗口',
  };
  if (launchHint) {
    launchHint.textContent = launchHints[access.platform] || launchHints.linux;
  }
  if (access.platform === 'darwin' && !access.trusted) {
    document.getElementById('accessBanner').style.display = 'flex';
  }
}

document.getElementById('addProfile').addEventListener('click', async () => {
  const item = await window.huaci.addProfile({ name: '新工作流' });
  config.difyProfiles.push(item);
  renderProfiles();
  refreshProfileSelects();
});

document.getElementById('addButton').addEventListener('click', async () => {
  const defaultProfileId = config.difyProfiles[0]?.id || null;
  const item = await window.huaci.addButton({
    label: '新按钮',
    type: 'dify',
    difyProfileId: defaultProfileId,
    enabled: true,
    primary: false,
  });
  config.toolbarButtons.push(item);
  renderButtons();
});

document.getElementById('save').addEventListener('click', async () => {
  const data = collectFormData();
  config = await window.huaci.saveConfig(data);
  showToast();
});

document.getElementById('launchAtLogin').addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  try {
    await window.huaci.setLaunchAtLogin(enabled);
    config.launchAtLogin = enabled;
    showToast();
  } catch {
    e.target.checked = !enabled;
  }
});

document.getElementById('selectionEnabled').addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  config = await window.huaci.saveConfig({ selectionEnabled: enabled });
  showToast();
});

document.getElementById('openAccessibility').addEventListener('click', () => {
  window.huaci.openAccessibilitySettings();
});

load();
