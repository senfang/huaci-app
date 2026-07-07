const SelectionHook = require('selection-hook');
const { normalizeAnchor } = require('./coordinates');
const focusMonitor = require('./focus-monitor');

const MIN_LENGTH = 1;
const MAX_LENGTH = 2000;
const { PositionLevel, INVALID_COORDINATE } = SelectionHook;

let hook = null;
let enabled = true;
let suppressUntil = 0;
let savedCallbacks = null;
let onSelectionCallback = null;
let onMouseDownCallback = null;
let onDismissCallback = null;

const WIN_CLIPBOARD_EXCLUDE = [
  'msedgewebview2.exe',
  'MSEdgeWebView2.exe',
  'Microsoft.Photos.exe',
  'Photos.exe',
  'PhotoViewer.exe',
];

const WIN_GLOBAL_EXCLUDE = [
  'Electron',
  'msedgewebview2.exe',
  'MSEdgeWebView2.exe',
  'Microsoft.Photos.exe',
  'Photos.exe',
  'PhotoViewer.exe',
];

function isWebView2Process(programName) {
  return (programName || '').toLowerCase().includes('msedgewebview2');
}

function applyHookConfig() {
  if (!hook) return;

  hook.setGlobalFilterMode(SelectionHook.FilterMode.EXCLUDE_LIST, WIN_GLOBAL_EXCLUDE);

  if (process.platform === 'win32') {
    hook.setClipboardMode(SelectionHook.FilterMode.EXCLUDE_LIST, WIN_CLIPBOARD_EXCLUDE);
  }
}

function attachHookListeners() {
  hook.on('text-selection', handleSelection);
  hook.on('mouse-down', handleMouseDown);
  hook.on('key-down', handleKeyDown);
  hook.on('error', (err) => {
    console.error('[selection-hook]', err);
  });
}

function detachHook() {
  if (!hook) return;
  try {
    hook.removeAllListeners();
    if (hook.isRunning()) {
      hook.stop();
    }
    hook.cleanup();
  } catch (err) {
    console.error('[selection-hook] detach failed', err);
  }
  hook = null;
}

function createAndStartHook() {
  hook = new SelectionHook();
  attachHookListeners();
  applyHookConfig();

  const startConfig = {
    debug: false,
    enableClipboard: process.platform !== 'win32',
  };

  const started = hook.start(startConfig);
  if (!started) {
    console.warn('[selection-hook] failed to start');
  }
  return started;
}

function recreateSelectionHook(reason) {
  if (process.platform !== 'win32' || !savedCallbacks || !enabled) return;

  console.log('[selection-hook] recreate:', reason || 'unknown');
  detachHook();
  createAndStartHook();
}

function isValidCoord(value) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value !== INVALID_COORDINATE &&
    value > -9999
  );
}

function isValidPoint(point) {
  return point && isValidCoord(point.x) && isValidCoord(point.y);
}

function getSelectionRect(data) {
  const points = [data.startTop, data.startBottom, data.endTop, data.endBottom].filter(isValidPoint);
  if (points.length < 2) return null;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const rect = {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };

  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (width < 1 && height < 1) return null;

  return rect;
}

function getSelectionAnchor(data) {
  const posLevel = data.posLevel ?? PositionLevel.NONE;

  if (posLevel >= PositionLevel.SEL_FULL) {
    const rect = getSelectionRect(data);
    if (rect) {
      return {
        x: (rect.left + rect.right) / 2,
        y: rect.top,
        rect,
      };
    }
    if (isValidPoint(data.endBottom)) {
      return { x: data.endBottom.x, y: data.endBottom.y, rect: null };
    }
  }

  if (posLevel >= PositionLevel.MOUSE_SINGLE && isValidPoint(data.mousePosEnd)) {
    return { x: data.mousePosEnd.x, y: data.mousePosEnd.y, rect: null };
  }
  if (isValidPoint(data.mousePosStart)) {
    return { x: data.mousePosStart.x, y: data.mousePosStart.y, rect: null };
  }

  return null;
}

function handleSelection(data) {
  if (!enabled) return;
  if (Date.now() < suppressUntil) return;
  if (!onSelectionCallback) return;

  if (isWebView2Process(data.programName)) {
    onDismissCallback?.();
    return;
  }

  if (!data?.text?.trim()) {
    onDismissCallback?.();
    return;
  }

  const text = data.text.trim();
  if (text.length < MIN_LENGTH || text.length > MAX_LENGTH) {
    onDismissCallback?.();
    return;
  }

  const program = (data.programName || '').toLowerCase();
  if (program.includes('electron') || program.includes('huaci')) return;

  const anchor = getSelectionAnchor(data);
  const normalized = normalizeAnchor(anchor);
  onSelectionCallback({
    text,
    x: normalized.x,
    y: normalized.y,
    rect: normalized.rect,
  });
}

function handleMouseDown(data) {
  if (!enabled) return;
  if (Date.now() < suppressUntil) return;
  onMouseDownCallback?.(data);
}

function handleKeyDown(data) {
  if (!enabled) return;
  if (data?.uniKey === 'Escape') {
    onDismissCallback?.({ escape: true });
  }
}

function startSelectionMonitor(callbacks) {
  savedCallbacks = callbacks || {};
  onSelectionCallback = savedCallbacks.onSelection;
  onMouseDownCallback = savedCallbacks.onMouseDown;
  onDismissCallback = savedCallbacks.onDismiss;

  createAndStartHook();

  if (process.platform === 'win32') {
    focusMonitor.startFocusMonitor((nextProcess) => {
      recreateSelectionHook(`leave webview2 -> ${nextProcess}`);
    });
  }
}

function stopSelectionMonitor() {
  focusMonitor.stopFocusMonitor();
  detachHook();
  savedCallbacks = null;
  onSelectionCallback = null;
  onMouseDownCallback = null;
  onDismissCallback = null;
}

function setMonitorEnabled(value) {
  enabled = value;
}

function suppressCapture(ms = 600) {
  suppressUntil = Date.now() + ms;
}

function isAccessibilityTrusted() {
  if (process.platform === 'darwin' && hook?.macIsProcessTrusted) {
    return hook.macIsProcessTrusted();
  }
  return true;
}

module.exports = {
  startSelectionMonitor,
  stopSelectionMonitor,
  setMonitorEnabled,
  suppressCapture,
  isAccessibilityTrusted,
};
