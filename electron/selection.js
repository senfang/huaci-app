const SelectionHook = require('selection-hook');
const { normalizeAnchor, toElectronPoint } = require('./coordinates');

const MIN_LENGTH = 1;
const MAX_LENGTH = 2000;
const { PositionLevel, INVALID_COORDINATE } = SelectionHook;

let hook = null;
let enabled = true;
let suppressUntil = 0;
let onSelectionCallback = null;
let onMouseDownCallback = null;
let onDismissCallback = null;
let awaitingSelectionAfterMouseDown = false;
let restartTimer = null;

const WIN_IMAGE_VIEWER_FILTER = [
  'Microsoft.Photos',
  'Microsoft.Photos.exe',
  'Photos',
  'Photos.exe',
  'PhotoViewer',
  'PhotoViewer.exe',
  'MSPhotos',
  // Windows 11「照片」等 UWP 图片查看器通过 WebView2 托管
  'msedgewebview2',
  'msedgewebview2.exe',
  'MSEdgeWebView2',
  'MSEdgeWebView2.exe',
];

function isWebView2Process(programName) {
  return (programName || '').toLowerCase().includes('msedgewebview2');
}

function applyGlobalFilter() {
  if (!hook) return;
  const exclude = ['Electron'];
  if (process.platform === 'win32') {
    exclude.push(...WIN_IMAGE_VIEWER_FILTER);
  }
  hook.setGlobalFilterMode(SelectionHook.FilterMode.EXCLUDE_LIST, exclude);
}

function cancelHookRestart() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
}

function restartHookIfNeeded() {
  if (process.platform !== 'win32' || !hook) return;

  cancelHookRestart();
  try {
    if (hook.isRunning()) {
      hook.stop();
    }
    hook.start({ enableClipboard: true, debug: false });
    applyGlobalFilter();
  } catch (err) {
    console.error('[selection-hook] restart failed', err);
  }
}

function scheduleHookRestart(delay = 450) {
  if (process.platform !== 'win32' || !hook) return;
  cancelHookRestart();
  restartTimer = setTimeout(() => {
    restartTimer = null;
    awaitingSelectionAfterMouseDown = false;
    restartHookIfNeeded();
  }, delay);
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
  // Native 模块未拿到选区矩形时，四个角会保持 CGPointZero (0,0)
  if (width < 1 && height < 1) return null;

  return rect;
}

function getSelectionAnchor(data) {
  const posLevel = data.posLevel ?? PositionLevel.NONE;

  // 只有 posLevel >= SEL_FULL 时，段落坐标才可信
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

  // 拖拽/点击选词：用鼠标位置（此时段落坐标往往是占位符 0,0）
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

  if (!data?.text?.trim()) {
    onDismissCallback?.();
    if (process.platform === 'win32') {
      scheduleHookRestart(isWebView2Process(data.programName) ? 80 : 300);
    }
    return;
  }

  const text = data.text.trim();
  if (text.length < MIN_LENGTH || text.length > MAX_LENGTH) {
    onDismissCallback?.();
    if (process.platform === 'win32') {
      scheduleHookRestart(isWebView2Process(data.programName) ? 80 : 300);
    }
    return;
  }

  if (isWebView2Process(data.programName)) {
    onDismissCallback?.();
    scheduleHookRestart(80);
    return;
  }

  const program = (data.programName || '').toLowerCase();
  if (program.includes('electron') || program.includes('huaci')) return;

  awaitingSelectionAfterMouseDown = false;
  cancelHookRestart();

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
  awaitingSelectionAfterMouseDown = true;
  onMouseDownCallback?.(data);
}

function handleMouseUp() {
  if (!enabled || process.platform !== 'win32') return;
  if (!awaitingSelectionAfterMouseDown) return;
  scheduleHookRestart(450);
}

function handleKeyDown(data) {
  if (!enabled) return;
  if (data?.uniKey === 'Escape') {
    onDismissCallback?.({ escape: true });
  }
}

function startSelectionMonitor(callbacks) {
  const { onSelection, onMouseDown, onDismiss } = callbacks || {};
  onSelectionCallback = onSelection;
  onMouseDownCallback = onMouseDown;
  onDismissCallback = onDismiss;
  hook = new SelectionHook();

  hook.on('text-selection', handleSelection);
  hook.on('mouse-down', handleMouseDown);
  hook.on('mouse-up', handleMouseUp);
  hook.on('key-down', handleKeyDown);
  hook.on('error', (err) => {
    console.error('[selection-hook]', err);
  });

  applyGlobalFilter();

  const started = hook.start({
    enableClipboard: true,
    debug: false,
  });

  if (!started) {
    console.warn('[selection-hook] failed to start');
  }
}

function stopSelectionMonitor() {
  cancelHookRestart();
  if (hook) {
    try {
      hook.stop();
      hook.cleanup();
    } catch {
      // ignore
    }
    hook = null;
  }
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
