const SelectionHook = require('selection-hook');

const MIN_LENGTH = 1;
const MAX_LENGTH = 2000;

let hook = null;
let enabled = true;
let suppressUntil = 0;
let onSelectionCallback = null;

function getAnchorPoint(data) {
  const end = data.mousePosEnd;
  if (end && end.x != null && end.y != null) {
    return { x: end.x, y: end.y };
  }
  const top = data.endTop || data.startTop;
  if (top && top.x != null && top.y != null) {
    return { x: top.x, y: top.y + 8 };
  }
  return { x: 0, y: 0 };
}

function handleSelection(data) {
  if (!enabled) return;
  if (Date.now() < suppressUntil) return;
  if (!onSelectionCallback || !data?.text) return;

  const text = data.text.trim();
  if (text.length < MIN_LENGTH || text.length > MAX_LENGTH) return;

  const program = (data.programName || '').toLowerCase();
  if (program.includes('electron') || program.includes('huaci')) return;

  const { x, y } = getAnchorPoint(data);
  onSelectionCallback({ text, x, y });
}

function startSelectionMonitor(callback) {
  onSelectionCallback = callback;
  hook = new SelectionHook();

  hook.on('text-selection', handleSelection);
  hook.on('error', (err) => {
    console.error('[selection-hook]', err);
  });

  hook.setGlobalFilterMode(SelectionHook.FilterMode.EXCLUDE_LIST, ['Electron']);

  const started = hook.start({
    enableClipboard: true,
    debug: false,
  });

  if (!started) {
    console.warn('[selection-hook] failed to start');
  }
}

function stopSelectionMonitor() {
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
