const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  clipboard,
  shell,
  systemPreferences,
} = require('electron');

const config = require('./app-config');
const { runDifyWorkflow } = require('./dify');
const selection = require('./selection');
const windows = require('./windows');
const loginItem = require('./login-item');
const { getTrayIcon, getAppIcon } = require('./icons');

let tray = null;
let activeAbort = null;
let pendingSelectedText = '';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function promptAccessibility() {
  if (process.platform !== 'darwin') return;
  const trusted = systemPreferences.isTrustedAccessibilityClient(true);
  if (!trusted) {
    windows.createSettingsWindow();
  }
}

function buildTrayMenu() {
  const cfg = config.getConfig();
  return Menu.buildFromTemplate([
    {
      label: cfg.selectionEnabled ? '划词监听：已开启' : '划词监听：已关闭',
      click: () => {
        const next = !config.getConfig().selectionEnabled;
        config.saveConfig({ selectionEnabled: next });
        selection.setMonitorEnabled(next);
        updateTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: '打开设置',
      click: () => windows.createSettingsWindow(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit(),
    },
  ]);
}

function updateTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  tray = new Tray(getTrayIcon());
  tray.setToolTip('划词助手');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => windows.createSettingsWindow());
}

function handleSelection({ text, x, y }) {
  pendingSelectedText = text;
  const buttons = config.getEnabledToolbarButtons();
  if (!buttons.length) return;

  windows.showToolbar({ text, x, y, buttons });
}

function abortActiveWorkflow() {
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }
}

function registerIpc() {
  ipcMain.handle('config:get', () => config.getConfig());

  ipcMain.handle('config:save', (_e, partial) => {
    const saved = config.saveConfig(partial);
    updateTrayMenu();
    selection.setMonitorEnabled(saved.selectionEnabled !== false);
    if ('launchAtLogin' in partial) {
      loginItem.applyLaunchAtLogin(saved.launchAtLogin);
    }
    return saved;
  });

  ipcMain.handle('app:setLaunchAtLogin', (_e, enabled) => {
    loginItem.applyLaunchAtLogin(enabled);
    config.saveConfig({ launchAtLogin: !!enabled });
    return loginItem.getLaunchAtLogin();
  });

  ipcMain.handle('app:getLaunchAtLogin', () => loginItem.getLaunchAtLogin());

  ipcMain.handle('config:addProfile', (_e, profile) => config.addDifyProfile(profile));
  ipcMain.handle('config:updateProfile', (_e, id, updates) => config.updateDifyProfile(id, updates));
  ipcMain.handle('config:deleteProfile', (_e, id) => config.deleteDifyProfile(id));
  ipcMain.handle('config:addButton', (_e, button) => config.addToolbarButton(button));
  ipcMain.handle('config:updateButton', (_e, id, updates) => config.updateToolbarButton(id, updates));
  ipcMain.handle('config:deleteButton', (_e, id) => config.deleteToolbarButton(id));
  ipcMain.handle('config:reorderButtons', (_e, ids) => config.reorderToolbarButtons(ids));

  ipcMain.on('toolbar:action', (_e, { action, buttonId, text }) => {
    selection.suppressCapture();
    windows.hideToolbar();

    const selectedText = text || pendingSelectedText;
    const button = config.getConfig().toolbarButtons.find((b) => b.id === buttonId);

    if (action === 'copy' || button?.type === 'copy') {
      clipboard.writeText(selectedText);
      return;
    }

    if (button?.type === 'dify') {
      const profile = config.getDifyProfile(button.difyProfileId);
      if (!profile) {
        windows.showDialog({
          text: selectedText,
          title: button.label,
          profileId: null,
        });
        windows.sendDialogEvent({ type: 'error', message: '未找到关联的 Dify 配置' });
        return;
      }

      windows.showDialog({
        text: selectedText,
        title: button.label,
        profileId: profile.id,
      });
    }
  });

  ipcMain.on('toolbar:resize', (_e, { width, height }) => {
    windows.resizeToolbar(width, height);
  });

  ipcMain.on('toolbar:hide', () => {
    windows.hideToolbar();
  });

  ipcMain.on('dialog:close', () => {
    abortActiveWorkflow();
    windows.hideDialog();
  });

  ipcMain.on('dialog:run', (_e, { text, profileId }) => {
    abortActiveWorkflow();
    const profile = config.getDifyProfile(profileId);
    if (!profile) {
      windows.sendDialogEvent({ type: 'error', message: 'Dify 配置不存在' });
      return;
    }

    const controller = new AbortController();
    activeAbort = controller;

    runDifyWorkflow(
      profile,
      text,
      (event) => windows.sendDialogEvent({ type: 'event', event }),
      controller.signal
    )
      .then(() => {
        windows.sendDialogEvent({ type: 'done' });
      })
      .catch((err) => {
        if (err.name === 'AbortError') {
          windows.sendDialogEvent({ type: 'aborted' });
          return;
        }
        windows.sendDialogEvent({ type: 'error', message: err.message || '请求失败' });
      })
      .finally(() => {
        activeAbort = null;
      });
  });

  ipcMain.on('dialog:abort', () => {
    abortActiveWorkflow();
  });

  ipcMain.handle('app:checkAccessibility', () => ({
    platform: process.platform,
    trusted: process.platform === 'darwin'
      ? systemPreferences.isTrustedAccessibilityClient(false)
      : selection.isAccessibilityTrusted(),
  }));

  ipcMain.on('app:openAccessibilitySettings', () => {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    }
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.surspark.huaci');
  }

  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  createTray();
  registerIpc();
  promptAccessibility();

  const cfg = config.getConfig();
  selection.setMonitorEnabled(cfg.selectionEnabled !== false);
  loginItem.syncLaunchAtLogin(cfg.launchAtLogin);
  selection.startSelectionMonitor(handleSelection);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windows.createSettingsWindow();
    }
  });
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  selection.stopSelectionMonitor();
});

app.on('second-instance', () => {
  windows.createSettingsWindow();
});
