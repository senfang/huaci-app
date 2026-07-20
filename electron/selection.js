const SelectionHook = require('selection-hook');
const {
  normalizeAnchor,
  normalizeKeyboardAnchor,
  isPointOnScreen,
  toElectronPoint,
} = require('./coordinates');
const focusMonitor = require('./focus-monitor');
const diagnostics = require('./selection-diagnostics');
const windows = require('./windows');
const config = require('./app-config');

const MIN_LENGTH = 1;
const KEYBOARD_FETCH_DELAY_MS = 120;
const DRAG_FETCH_DELAY_MS = 120;
const SCREENSHOT_SUPPRESS_MS = 10000;
const SELF_APP_IDS = ['com.surspark.huaci'];
const SPREADSHEET_PROGRAM_PATTERNS = [
  'excel',
  'wps',
  'et.exe',
  'feishu',
  'lark',
  'numbers',
  'calc',
  'sheet',
  'spreadsheet',
];
const SPREADSHEET_CLIPBOARD_PROGRAMS = [
  'EXCEL.EXE',
  'Feishu.exe',
  'Lark.exe',
  'wps.exe',
  'et.exe',
  'Numbers.app',
  'soffice.bin',
  'scalc',
];
const { PositionLevel, INVALID_COORDINATE, SelectionMethod, FilterMode } = SelectionHook;

let hook = null;
let enabled = true;
let suppressUntil = 0;
let savedCallbacks = null;
let onSelectionCallback = null;
let onMouseDownCallback = null;
let onDismissCallback = null;
let heartbeatTimer = null;
let lastMouseDown = null;
let lastMouseUp = null;
let lastDragStart = null;
let lastDragEnd = null;
let probeTimer = null;
let dragFetchTimer = null;
let keyboardFetchTimer = null;
let selectionSinceMouseDown = false;
let lastAcceptedText = '';
let lastAcceptedAt = 0;
let screenshotSessionUntil = 0;
const modifierState = {
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
};

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
  hook.on('key-up', handleKeyUp);
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
  if (toClass === 'screenshot-shell') {
    enterScreenshotSession('foreground-screenshot', 15000);
    return;
  }

  if (fromClass === 'screenshot-shell') {
    enterScreenshotSession('left-screenshot', 4000);
    return;
  }

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

function cancelPendingSelectionFetches() {
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
  if (dragFetchTimer) {
    clearTimeout(dragFetchTimer);
    dragFetchTimer = null;
  }
  if (keyboardFetchTimer) {
    clearTimeout(keyboardFetchTimer);
    keyboardFetchTimer = null;
  }
}

function enterScreenshotSession(reason, ms = SCREENSHOT_SUPPRESS_MS) {
  if (process.platform !== 'win32') return;

  const until = Date.now() + ms;
  screenshotSessionUntil = Math.max(screenshotSessionUntil, until);
  suppressUntil = Math.max(suppressUntil, until);
  cancelPendingSelectionFetches();
  windows.hideToolbar();
  diagnostics.log('screenshot session', { reason, ms, until: screenshotSessionUntil });
}

function isCaptureBlocked() {
  if (Date.now() < suppressUntil) return true;
  if (process.platform !== 'win32') return false;
  if (Date.now() < screenshotSessionUntil) return true;
  return focusMonitor.isScreenshotForeground?.() || false;
}

function updateModifierState(data, pressed) {
  if (process.platform !== 'win32') return;

  const key = data?.uniKey || '';
  if (key === 'Control') modifierState.ctrl = pressed;
  if (key === 'Alt') modifierState.alt = pressed;
  if (key === 'Shift') modifierState.shift = pressed;
  if (key === 'Meta') modifierState.meta = pressed;
}

function isScreenshotHotkeyDown(data) {
  if (process.platform !== 'win32') return false;

  const key = (data?.uniKey || '').toLowerCase();
  if (key === 'printscreen') return true;

  if (key === 'a' && modifierState.alt && !modifierState.ctrl) return true;
  if (key === 'a' && modifierState.ctrl && modifierState.alt) return true;
  if (key === 's' && modifierState.meta && modifierState.shift) return true;

  return false;
}

function createAndStartHook(reason) {
  hook = new SelectionHook();
  attachHookListeners();

  hook.setGlobalFilterMode(FilterMode.EXCLUDE_LIST, SELF_APP_IDS);
  hook.setClipboardMode(FilterMode.EXCLUDE_LIST, SPREADSHEET_CLIPBOARD_PROGRAMS);

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

function toUsablePoint(point, posLevel = PositionLevel.NONE) {
  if (!point || !isValidCoord(point.x) || !isValidCoord(point.y)) return null;
  // selection-hook fills missing AX coords with (0,0); that is on-screen but not real.
  if (posLevel < PositionLevel.SEL_FULL && point.x === 0 && point.y === 0) return null;
  const dip = toElectronPoint(point);
  if (!dip || !isPointOnScreen(dip.x, dip.y)) return null;
  return dip;
}

function pickMouseSelectionEnd(data) {
  const posLevel = data?.posLevel ?? PositionLevel.NONE;
  const start = toUsablePoint(data.mousePosStart, posLevel);
  const end = toUsablePoint(data.mousePosEnd, posLevel);
  if (start && end) {
    if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
      return end.x >= start.x ? end : start;
    }
    return end.y >= start.y ? end : start;
  }
  return end || start;
}

function enrichDragPoints(data) {
  if (!data) return data;
  const posLevel = data?.posLevel ?? PositionLevel.NONE;
  const enriched = { ...data };
  if (!toUsablePoint(data.mousePosEnd, posLevel) && lastDragEnd) {
    enriched.mousePosEnd = { ...lastDragEnd };
  }
  if (!toUsablePoint(data.mousePosStart, posLevel) && lastDragStart) {
    enriched.mousePosStart = { ...lastDragStart };
  }
  return enriched;
}

function isValidPoint(point) {
  return !!toUsablePoint(point);
}

function getSelectionRect(data) {
  const posLevel = data?.posLevel ?? PositionLevel.NONE;
  if (posLevel < PositionLevel.SEL_FULL) return null;

  const points = [data.startTop, data.startBottom, data.endTop, data.endBottom]
    .map((point) => toUsablePoint(point, posLevel))
    .filter(Boolean);
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

function getMaxSelectionLength() {
  return config.getConfig().selectionMaxLength ?? 50000;
}

function getSelectionAnchor(data, source = 'mouse') {
  if (source === 'ctrl+a') {
    return null;
  }

  const posLevel = data?.posLevel ?? PositionLevel.NONE;

  if (posLevel >= PositionLevel.SEL_FULL) {
    const endPoint =
      toUsablePoint(data.endBottom, posLevel) || toUsablePoint(data.endTop, posLevel);
    if (endPoint) {
      return { x: endPoint.x, y: endPoint.y, rect: null };
    }

    const rect = getSelectionRect(data);
    if (rect) {
      return {
        x: rect.right,
        y: Math.round((rect.top + rect.bottom) / 2),
        rect: null,
      };
    }
  }

  const mouseEnd = pickMouseSelectionEnd(data);
  if (mouseEnd) {
    return { x: mouseEnd.x, y: mouseEnd.y, rect: null };
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

function isSelfProgram(programName = '') {
  const program = programName.toLowerCase();
  return SELF_APP_IDS.some((id) => program === id.toLowerCase());
}

function isSpreadsheetProgram(programName = '') {
  const program = programName.toLowerCase();
  if (!program) return false;
  return SPREADSHEET_PROGRAM_PATTERNS.some((pattern) => program.includes(pattern));
}

function looksLikeGridSelection(text, programName = '') {
  const lines = String(text || '')
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  if (lines.length === 0) return false;

  const tabCounts = lines.map((line) => (line.match(/\t/g) || []).length);
  const maxTabs = Math.max(...tabCounts, 0);
  if (maxTabs === 0) return false;

  if (lines.length >= 2) return true;
  if (maxTabs >= 2) return true;
  if (maxTabs >= 1 && isSpreadsheetProgram(programName)) return true;
  if (maxTabs >= 1 && lines.length === 1) {
    const parts = lines[0].split('\t');
    if (parts.length >= 2 && parts.every((part) => part.length <= 200)) return true;
  }

  return false;
}

function shouldSkipSpreadsheetSelection(data, source = 'mouse') {
  const program = data?.programName || '';
  const text = data?.text?.trim() || '';

  if (looksLikeGridSelection(text, program)) {
    return 'grid-selection';
  }

  if (
    isSpreadsheetProgram(program) &&
    data?.method === SelectionMethod.CLIPBOARD &&
    source !== 'ctrl+a'
  ) {
    return 'spreadsheet-clipboard';
  }

  if (source === 'drag-fetch') {
    return 'drag-fetch-disabled';
  }

  return '';
}

function withMouseAnchor(data) {
  return enrichDragPoints(data);
}

function fetchSelectionAfterDrag(reason) {
  if (!hook?.isRunning() || selectionSinceMouseDown) return;

  let selection = null;
  try {
    selection = hook.getCurrentSelection();
  } catch (err) {
    diagnostics.log('drag selection failed', {
      reason,
      message: err?.message || String(err),
      ...hookState(),
    });
  }

  if (selection?.text?.trim()) {
    processSelectionData(withMouseAnchor(selection), 'drag-fetch');
  } else {
    diagnostics.log('drag selection empty', { reason, ...hookState() });
  }
}

function scheduleSelectionProbe(reason) {
  if (!hook?.isRunning()) return;
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = setTimeout(() => {
    probeTimer = null;
    try {
      const probe = hook.getCurrentSelection();
      diagnostics.log('probe getCurrentSelection', {
        reason,
        ok: !!(probe?.text?.trim()),
        hadTextSelectionEvent: selectionSinceMouseDown,
        gap:
          probe?.text?.trim() && !selectionSinceMouseDown
            ? 'hook-missed-but-probe-ok'
            : probe?.text?.trim()
              ? 'both-ok'
              : 'both-fail',
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

function scheduleDragSelectionFetch(reason) {
  if (!hook?.isRunning()) return;
  if (dragFetchTimer) clearTimeout(dragFetchTimer);
  dragFetchTimer = setTimeout(() => {
    dragFetchTimer = null;
    fetchSelectionAfterDrag(reason);
  }, DRAG_FETCH_DELAY_MS);
}

function processSelectionData(data, source = 'mouse') {
  diagnostics.mark('text-selection');
  diagnostics.log('event text-selection', { source, ...summarizeSelection(data) });

  if (!enabled) {
    diagnostics.log('selection skipped', { reason: 'monitor disabled', ...hookState() });
    return;
  }
  if (isCaptureBlocked()) {
    diagnostics.log('selection skipped', { reason: 'screenshot or suppressed', ...hookState() });
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
  const maxLength = getMaxSelectionLength();
  if (text.length < MIN_LENGTH || text.length > maxLength) {
    onDismissCallback?.();
    diagnostics.log('selection skipped', {
      reason: 'invalid length',
      len: text.length,
      maxLength,
      ...hookState(),
    });
    return;
  }

  const program = (data.programName || '').toLowerCase();
  if (isSelfProgram(program)) {
    diagnostics.log('selection skipped', { reason: 'self app', program, ...hookState() });
    return;
  }

  const spreadsheetSkip = shouldSkipSpreadsheetSelection(data, source);
  if (spreadsheetSkip) {
    onDismissCallback?.();
    diagnostics.log('selection skipped', {
      reason: spreadsheetSkip,
      program,
      source,
      ...hookState(),
    });
    return;
  }

  const now = Date.now();
  if (text === lastAcceptedText && now - lastAcceptedAt < 400) {
    diagnostics.log('selection skipped', { reason: 'duplicate', ...hookState() });
    return;
  }

  const anchor =
    source === 'ctrl+a'
      ? normalizeKeyboardAnchor()
      : normalizeAnchor(getSelectionAnchor(enrichDragPoints(data), source));
  lastAcceptedText = text;
  lastAcceptedAt = now;

  diagnostics.mark('selection-accepted');
  diagnostics.log('selection accepted', {
    program,
    source,
    textPreview: text.slice(0, 40),
    anchor,
    ...hookState(),
  });

  onSelectionCallback({
    text,
    x: anchor.x,
    y: anchor.y,
    rect: anchor.rect,
  });
}

function handleSelection(data) {
  selectionSinceMouseDown = true;
  processSelectionData(data, 'mouse');
}

function scheduleKeyboardSelectionFetch(reason) {
  if (!hook?.isRunning()) return;
  if (keyboardFetchTimer) clearTimeout(keyboardFetchTimer);
  keyboardFetchTimer = setTimeout(() => {
    keyboardFetchTimer = null;
    try {
      const selection = hook.getCurrentSelection();
      if (selection?.text?.trim()) {
        processSelectionData(selection, reason);
      } else {
        diagnostics.log('keyboard selection empty', { reason, ...hookState() });
      }
    } catch (err) {
      diagnostics.log('keyboard selection failed', {
        reason,
        message: err?.message || String(err),
        ...hookState(),
      });
    }
  }, KEYBOARD_FETCH_DELAY_MS);
}

function handleMouseDown(data) {
  diagnostics.count('mouse-down');
  selectionSinceMouseDown = false;
  lastDragStart = data?.x != null ? { x: data.x, y: data.y } : null;
  lastMouseDown = lastDragStart ? { ...lastDragStart, t: Date.now() } : null;
  if (!enabled) return;
  if (isCaptureBlocked()) return;
  onMouseDownCallback?.(data);
}

function handleMouseUp(data) {
  diagnostics.count('mouse-up');
  lastDragEnd = data?.x != null ? { x: data.x, y: data.y } : null;
  lastMouseUp = lastDragEnd;
  const distance = dragDistance(lastMouseDown, data);
  if (distance >= 8 && enabled && !isCaptureBlocked()) {
    const reason = `mouse-up drag=${Math.round(distance)}`;
    scheduleSelectionProbe(reason);
    // Do not drag-fetch: spreadsheet cell drags have no text-selection event but
    // getCurrentSelection() would simulate Ctrl+C and pop the toolbar.
  }
  lastMouseDown = null;
}

function handleKeyDown(data) {
  updateModifierState(data, true);

  if (process.platform === 'win32' && isScreenshotHotkeyDown(data)) {
    enterScreenshotSession(`hotkey:${data?.uniKey || 'unknown'}`);
  }

  if (data?.uniKey === 'Escape') {
    onDismissCallback?.({ escape: true });
  }
}

function isCtrlAKeyUp(data) {
  if ((data?.uniKey || '').toLowerCase() !== 'a') return false;
  if (process.platform === 'win32') {
    return modifierState.ctrl && !modifierState.alt;
  }
  return !!data?.sys;
}

function handleKeyUp(data) {
  updateModifierState(data, false);

  if (!enabled || isCaptureBlocked()) return;
  if (!isCtrlAKeyUp(data)) return;
  diagnostics.log('keyboard select-all', { uniKey: data.uniKey, ...hookState() });
  scheduleKeyboardSelectionFetch('ctrl+a');
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
  if (dragFetchTimer) {
    clearTimeout(dragFetchTimer);
    dragFetchTimer = null;
  }
  if (keyboardFetchTimer) {
    clearTimeout(keyboardFetchTimer);
    keyboardFetchTimer = null;
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
  suppressUntil = Math.max(suppressUntil, Date.now() + ms);
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
