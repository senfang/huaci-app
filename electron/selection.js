const SelectionHook = require('selection-hook');
const { normalizeAnchor } = require('./coordinates');
const focusMonitor = require('./focus-monitor');
const diagnostics = require('./selection-diagnostics');
const windows = require('./windows');

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
let heartbeatTimer = null;
let lastMouseDown = null;
let probeTimer = null;

function hookState() {
  return {
    enabled,
    suppressUntil,
    hookExists: !!hook,
    hookRunning: hook ? hook.isRunning() : false,
    foreground: focusMonitor.getLastForeground?.() || '',
  };
}

function attachHookListeners() {
  hook.on('text-selection', handleSelection);
  hook.on('mouse-down', handleMouseDown);
  hook.on('mouse-up', handleMouseUp);
  hook.on('key-down', handleKeyDown);
  hook.on('status', (status) => {
    diagnostics.log('hook status', { status, ...hookState() });
  });
  hook.on('error', (err) => {
    diagnostics.log('hook error', { message: err?.message || String(err), ...hookState() });
  });
}

function detachHook(reason) {
  if (!hook) return;
  diagnostics.log('hook detach', { reason, ...hookState(), ...diagnostics.getStats() });
  try {
    hook.removeAllListeners();
    if (hook.isRunning()) {
      hook.stop();
    }
    hook.cleanup();
  } catch (err) {
    diagnostics.log('hook detach failed', { message: err?.message || String(err) });
  }
  hook = null;
}

function recreateHook(reason) {
  diagnostics.log('hook recreate', { reason, ...hookState() });
  detachHook(reason);
  createAndStartHook(reason);
}

function handleForegroundChange({ from, to, fromClass, toClass }) {
  if (toClass === 'image-viewer-shell') {
    windows.hideToolbar();
    return;
  }

  if (fromClass === 'image-viewer-shell') {
    diagnostics.log('recover after image viewer', { from, to, fromClass, toClass });
    windows.recreateToolbarAfterImageViewer();
    setTimeout(() => {
      recreateHook('left-image-viewer');
    }, 120);
  }
}

function createAndStartHook(reason) {
  hook = new SelectionHook();
  attachHookListeners();

  hook.setGlobalFilterMode(SelectionHook.FilterMode.EXCLUDE_LIST, ['Electron']);

  const startConfig = {
    debug: true,
    enableClipboard: true,
  };

  const started = hook.start(startConfig);
  diagnostics.log('hook start', { reason, started, ...hookState() });
  return started;
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

function summarizeSelection(data) {
  return {
    programName: data?.programName || '',
    method: data?.method,
    posLevel: data?.posLevel,
    textLen: data?.text?.trim()?.length || 0,
    mouseEnd: data?.mousePosEnd,
    endTop: data?.endTop,
  };
}

function dragDistance(start, end) {
  if (!start || !end) return 0;
  const dx = (end.x ?? 0) - (start.x ?? 0);
  const dy = (end.y ?? 0) - (start.y ?? 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function scheduleSelectionProbe(reason) {
  if (process.platform !== 'win32' || !hook?.isRunning()) return;
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = setTimeout(() => {
    probeTimer = null;
    try {
      const probe = hook.getCurrentSelection();
      diagnostics.log('probe getCurrentSelection', {
        reason,
        ok: !!(probe?.text?.trim()),
        textLen: probe?.text?.trim()?.length || 0,
        program: probe?.programName || '',
        method: probe?.method,
        posLevel: probe?.posLevel,
        ...hookState(),
      });
    } catch (err) {
      diagnostics.log('probe getCurrentSelection failed', {
        reason,
        message: err?.message || String(err),
        ...hookState(),
      });
    }
  }, 180);
}

function handleSelection(data) {
  diagnostics.mark('text-selection');
  diagnostics.log('event text-selection', summarizeSelection(data));

  if (!enabled) {
    diagnostics.log('selection skipped', { reason: 'monitor disabled', ...hookState() });
    return;
  }
  if (Date.now() < suppressUntil) {
    diagnostics.log('selection skipped', { reason: 'suppressed', ...hookState() });
    return;
  }
  if (!onSelectionCallback) {
    diagnostics.log('selection skipped', { reason: 'no callback', ...hookState() });
    return;
  }
  if (!data?.text?.trim()) {
    onDismissCallback?.();
    diagnostics.log('selection skipped', { reason: 'empty text', ...hookState() });
    return;
  }

  const text = data.text.trim();
  if (text.length < MIN_LENGTH || text.length > MAX_LENGTH) {
    onDismissCallback?.();
    diagnostics.log('selection skipped', { reason: 'invalid length', len: text.length, ...hookState() });
    return;
  }

  const program = (data.programName || '').toLowerCase();
  if (program.includes('electron') || program.includes('huaci')) {
    diagnostics.log('selection skipped', { reason: 'self app', program, ...hookState() });
    return;
  }

  const anchor = getSelectionAnchor(data);
  const normalized = normalizeAnchor(anchor);
  diagnostics.mark('selection-accepted');
  diagnostics.log('selection accepted', {
    program,
    textPreview: text.slice(0, 40),
    anchor: normalized,
    ...hookState(),
  });

  onSelectionCallback({
    text,
    x: normalized.x,
    y: normalized.y,
    rect: normalized.rect,
  });
}

function handleMouseDown(data) {
  diagnostics.count('mouse-down');
  lastMouseDown = { x: data?.x, y: data?.y, t: Date.now() };
  if (!enabled) return;
  if (Date.now() < suppressUntil) return;
  onMouseDownCallback?.(data);
}

function handleMouseUp(data) {
  diagnostics.count('mouse-up');
  const distance = dragDistance(lastMouseDown, data);
  if (distance >= 8) {
    scheduleSelectionProbe(`mouse-up drag=${Math.round(distance)}`);
  }
  lastMouseDown = null;
}

function handleKeyDown(data) {
  if (data?.uniKey === 'Escape') {
    onDismissCallback?.({ escape: true });
  }
}

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    diagnostics.logHeartbeat(hookState());
  }, 15000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startSelectionMonitor(callbacks) {
  savedCallbacks = callbacks || {};
  onSelectionCallback = savedCallbacks.onSelection;
  onMouseDownCallback = savedCallbacks.onMouseDown;
  onDismissCallback = savedCallbacks.onDismiss;

  diagnostics.log('monitor starting', hookState());
  createAndStartHook('initial');
  startHeartbeat();

  if (process.platform === 'win32') {
    focusMonitor.startFocusMonitor(handleForegroundChange);
  }
}

function stopSelectionMonitor() {
  stopHeartbeat();
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
  focusMonitor.stopFocusMonitor();
  detachHook('stop');
  savedCallbacks = null;
  onSelectionCallback = null;
  onMouseDownCallback = null;
  onDismissCallback = null;
}

function setMonitorEnabled(value) {
  enabled = value;
  diagnostics.log('monitor enabled changed', { enabled, ...hookState() });
}

function suppressCapture(ms = 600) {
  suppressUntil = Date.now() + ms;
  diagnostics.log('monitor suppress', { ms, until: suppressUntil });
}

function isAccessibilityTrusted() {
  if (process.platform === 'darwin' && hook?.macIsProcessTrusted) {
    return hook.macIsProcessTrusted();
  }
  return true;
}

function getDiagnosticsPath() {
  return diagnostics.getLogPath();
}

function markReproStart(label) {
  diagnostics.markReproStart(label);
}

module.exports = {
  startSelectionMonitor,
  stopSelectionMonitor,
  setMonitorEnabled,
  suppressCapture,
  isAccessibilityTrusted,
  getDiagnosticsPath,
  markReproStart,
};
