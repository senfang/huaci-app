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

function classifyProcess(name) {
  const n = (name || '').toLowerCase();
  if (!n) return 'unknown';
  if (n.includes('msedgewebview2')) return 'webview2';
  if (n.includes('msedge') || n.includes('chrome') || n.includes('firefox')) return 'browser';
  if (n.includes('applicationframehost') || n.includes('photos') || n.includes('photoviewer')) {
    return 'image-viewer-shell';
  }
  return 'other';
}

function startFocusMonitor() {
  if (process.platform !== 'win32' || pollTimer) return;

  pollTimer = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const current = await queryForegroundProcess();
      if (!current || current === lastForeground) return;

      const fromClass = classifyProcess(lastForeground);
      const toClass = classifyProcess(current);
      diagnostics.logPhase('foreground-changed', {
        from: lastForeground || null,
        to: current,
        fromClass,
        toClass,
      });
      lastForeground = current;
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
}

function getLastForeground() {
  return lastForeground;
}

module.exports = {
  startFocusMonitor,
  stopFocusMonitor,
  getLastForeground,
  queryForegroundProcess,
  classifyProcess,
};
