const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { getAppIcon } = require('./icons');
const diagnostics = require('./selection-diagnostics');

let toolbarWindow = null;
let toolbarNeedsRecreate = false;
let dialogWindow = null;
let settingsWindow = null;

function getPreload(name) {
  return path.join(__dirname, 'preload', `${name}.js`);
}

function getRendererHtml(name) {
  return path.join(__dirname, '..', 'renderer', name, 'index.html');
}

function destroyToolbarWindow() {
  if (toolbarWindow && !toolbarWindow.isDestroyed()) {
    toolbarWindow.destroy();
  }
  toolbarWindow = null;
}

function markToolbarNeedsRecreate(reason) {
  toolbarNeedsRecreate = true;
  diagnostics.log('toolbar mark recreate', { reason });
}

function createToolbarWindow() {
  if (toolbarWindow && !toolbarWindow.isDestroyed() && !toolbarNeedsRecreate) {
    return toolbarWindow;
  }

  destroyToolbarWindow();
  toolbarNeedsRecreate = false;

  const isMac = process.platform === 'darwin';
  toolbarWindow = new BrowserWindow({
    width: 420,
    height: 52,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    type: isMac ? 'panel' : 'normal',
    webPreferences: {
      preload: getPreload('toolbar'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  toolbarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (!isMac) {
    // Keep below system screenshot overlays (screen-saver level covers Snipping Tool on Windows).
    toolbarWindow.setAlwaysOnTop(true, 'floating');
  }
  toolbarWindow.loadFile(getRendererHtml('toolbar'));

  toolbarWindow.on('closed', () => {
    toolbarWindow = null;
  });

  return toolbarWindow;
}

function createDialogWindow() {
  if (dialogWindow && !dialogWindow.isDestroyed()) return dialogWindow;

  dialogWindow = new BrowserWindow({
    width: 600,
    height: 680,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    icon: getAppIcon(256),
    type: process.platform === 'darwin' ? 'panel' : 'normal',
    webPreferences: {
      preload: getPreload('dialog'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  dialogWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  dialogWindow.loadFile(getRendererHtml('dialog'));

  dialogWindow.on('closed', () => {
    dialogWindow = null;
  });

  return dialogWindow;
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: 720,
    height: 780,
    minWidth: 600,
    minHeight: 560,
    title: '划词助手设置',
    show: false,
    icon: getAppIcon(256),
    webPreferences: {
      preload: getPreload('settings'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(getRendererHtml('settings'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  return settingsWindow;
}

function hideToolbar() {
  if (toolbarWindow && !toolbarWindow.isDestroyed()) {
    toolbarWindow.hide();
  }
}

function recreateToolbarAfterImageViewer() {
  hideToolbar();
  markToolbarNeedsRecreate('left-image-viewer');
}

function isToolbarVisible() {
  return !!(toolbarWindow && !toolbarWindow.isDestroyed() && toolbarWindow.isVisible());
}

function isPointInToolbar(x, y) {
  if (!isToolbarVisible()) return false;
  const bounds = toolbarWindow.getBounds();
  return (
    x >= bounds.x &&
    x <= bounds.x + bounds.width &&
    y >= bounds.y &&
    y <= bounds.y + bounds.height
  );
}

function isDialogVisible() {
  return !!(dialogWindow && !dialogWindow.isDestroyed() && dialogWindow.isVisible());
}

function showToolbar(payload) {
  if (process.platform === 'win32' && toolbarNeedsRecreate) {
    destroyToolbarWindow();
    toolbarNeedsRecreate = false;
  }
  const win = createToolbarWindow();
  const { x, y, text, buttons, rect } = payload;

  const anchorX = rect ? (rect.left + rect.right) / 2 : x;
  const anchorY = rect ? rect.top : y;
  const display = screen.getDisplayNearestPoint({ x: anchorX, y: anchorY });
  const area = display.workArea;

  const showAt = () => {
    const [width, height] = win.getSize();
    let left = Math.round(anchorX - width / 2);
    let top = Math.round(anchorY - height - 12);

    left = Math.max(area.x + 8, Math.min(left, area.x + area.width - width - 8));
    if (top < area.y + 8) {
      top = Math.round((rect ? rect.bottom : anchorY) + 16);
    }
    top = Math.max(area.y + 8, Math.min(top, area.y + area.height - height - 8));

    win.setBounds({ x: left, y: top, width, height }, false);
    if (process.platform !== 'darwin') {
      win.setAlwaysOnTop(true, 'floating');
    }
    win.showInactive();
    win.webContents.send('toolbar:show', { text, buttons });

    diagnostics.log('toolbar shown', {
      bounds: win.getBounds(),
      isVisible: win.isVisible(),
      isDestroyed: win.isDestroyed(),
      anchorX,
      anchorY,
    });
  };

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', showAt);
  } else {
    showAt();
  }
}

function hideDialog() {
  if (dialogWindow && !dialogWindow.isDestroyed()) {
    dialogWindow.hide();
  }
}

function showDialog(payload) {
  const win = createDialogWindow();
  const { text, title, profileId } = payload;

  const primary = screen.getPrimaryDisplay();
  const { width, height } = win.getBounds();
  const x = Math.round(primary.workArea.x + (primary.workArea.width - width) / 2);
  const y = Math.round(primary.workArea.y + (primary.workArea.height - height) / 2);
  win.setBounds({ x, y, width, height });

  const open = () => {
    win.show();
    win.focus();
    win.webContents.send('dialog:open', { text, title, profileId });
  };

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', open);
  } else {
    open();
  }
}

function sendDialogEvent(event) {
  if (dialogWindow && !dialogWindow.isDestroyed()) {
    dialogWindow.webContents.send('dialog:event', event);
  }
}

function getOverlayWebContents() {
  const ids = [];
  if (toolbarWindow && !toolbarWindow.isDestroyed()) ids.push(toolbarWindow.webContents.id);
  if (dialogWindow && !dialogWindow.isDestroyed()) ids.push(dialogWindow.webContents.id);
  return ids;
}

function resizeToolbar(width, height) {
  if (toolbarWindow && !toolbarWindow.isDestroyed()) {
    const bounds = toolbarWindow.getBounds();
    toolbarWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: Math.max(80, Math.ceil(width)),
      height: Math.max(40, Math.ceil(height)),
    });
  }
}

module.exports = {
  createSettingsWindow,
  hideToolbar,
  showToolbar,
  hideDialog,
  showDialog,
  sendDialogEvent,
  getOverlayWebContents,
  resizeToolbar,
  isToolbarVisible,
  isPointInToolbar,
  isDialogVisible,
  recreateToolbarAfterImageViewer,
  markToolbarNeedsRecreate,
};
