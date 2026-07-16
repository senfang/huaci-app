const { execFile } = require('child_process');
const diagnostics = require('./selection-diagnostics');

const FOREGROUND_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Foreground {
  [DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint processId);
}
"@
$hwnd = [Win32Foreground]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { exit 1 }
$procId = 0
[void][Win32Foreground]::GetWindowThreadProcessId($hwnd, [ref]$procId)
if ($procId -eq 0) { exit 1 }
$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
if ($null -eq $p) { exit 1 }
Write-Output $p.ProcessName
`.trim();

let pollTimer = null;
let polling = false;
let lastForeground = '';
let lastForegroundClass = 'unknown';
let onForegroundChange = null;

function queryForegroundProcess() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', FOREGROUND_SCRIPT],
      { windowsHide: true, timeout: 2000, maxBuffer: 1024 },
      (err, stdout) => {
        if (err) {
          resolve('');
          return;
        }
        resolve(String(stdout || '').trim().toLowerCase());
      }
    );
  });
}

const SCREENSHOT_PROCESS_PATTERNS = [
  'snippingtool',
  'screenclip',
  'screenclippinghost',
  'sharex',
  'snipaste',
  'greenshot',
  'picpick',
  'lightshot',
  'snagit',
  'faststone',
  'hypersnap',
  'goscreen',
  'jietu',
  'screenshot',
  'screencapture',
];

function isScreenshotProcessName(name) {
  const n = (name || '').toLowerCase();
  if (!n) return false;
  return SCREENSHOT_PROCESS_PATTERNS.some((pattern) => n.includes(pattern));
}

function classifyProcess(name) {
  const n = (name || '').toLowerCase();
  if (!n) return 'unknown';
  if (isScreenshotProcessName(n)) return 'screenshot-shell';
  if (n.includes('msedgewebview2')) return 'webview2';
  if (n.includes('msedge') || n.includes('chrome') || n.includes('firefox')) return 'browser';
  if (n.includes('applicationframehost') || n.includes('photos') || n.includes('photoviewer')) {
    return 'image-viewer-shell';
  }
  return 'other';
}

function isScreenshotForeground() {
  return lastForegroundClass === 'screenshot-shell';
}

function startFocusMonitor(callback) {
  if (process.platform !== 'win32' || pollTimer) return;
  onForegroundChange = typeof callback === 'function' ? callback : null;

  queryForegroundProcess().then((current) => {
    if (!current) return;
    lastForeground = current;
    lastForegroundClass = classifyProcess(current);
  });

  pollTimer = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const current = await queryForegroundProcess();
      if (!current || current === lastForeground) return;

      const from = lastForeground;
      const fromClass = classifyProcess(from);
      const toClass = classifyProcess(current);
      diagnostics.logPhase('foreground-changed', {
        from: from || null,
        to: current,
        fromClass,
        toClass,
      });
      lastForeground = current;
      lastForegroundClass = toClass;

      if (onForegroundChange) {
        onForegroundChange({ from, to: current, fromClass, toClass });
      }
    } finally {
      polling = false;
    }
  }, 400);
}

function stopFocusMonitor() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  polling = false;
  lastForeground = '';
  lastForegroundClass = 'unknown';
  onForegroundChange = null;
}

function getLastForeground() {
  return lastForeground;
}

module.exports = {
  startFocusMonitor,
  stopFocusMonitor,
  getLastForeground,
  getLastForegroundClass: () => lastForegroundClass,
  isScreenshotForeground,
  isScreenshotProcessName,
  queryForegroundProcess,
  classifyProcess,
};
