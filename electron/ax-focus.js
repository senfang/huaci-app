const { execFileSync } = require('child_process');
const path = require('path');

const SPREADSHEET_AX_ROLES = new Set([
  'AXTable',
  'AXGrid',
  'AXCell',
  'AXRow',
  'AXColumn',
  'AXOutline',
]);

const TEXT_AX_ROLES = new Set([
  'AXTextArea',
  'AXTextField',
  'AXComboBox',
  'AXSearchField',
]);

const WIN_SPREADSHEET_CONTROL_TYPES = new Set([
  'DataGrid',
  'Table',
  'DataItem',
  'Custom',
]);

const WIN_TEXT_CONTROL_TYPES = new Set(['Edit', 'Document', 'Text']);

const UIA_FOCUS_SCRIPT = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$el = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $el) { Write-Output '{"ok":false}'; exit 0 }
$types = New-Object System.Collections.Generic.List[string]
$current = $el
for ($i = 0; $i -lt 12 -and $null -ne $current; $i++) {
  $types.Add($current.Current.ControlType.ProgrammaticName.Replace('ControlType.', ''))
  try { $current = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($current) } catch { break }
}
$spreadsheet = $types -contains 'DataGrid' -or $types -contains 'Table' -or $types -contains 'DataItem'
$text = $types -contains 'Edit' -or $types -contains 'Document'
@{ ok = $true; controlTypes = $types; spreadsheetLike = $spreadsheet; textLike = $text } | ConvertTo-Json -Compress
`.trim();

let lastProbe = {
  at: 0,
  result: null,
};

function classifyRoles(roles, spreadsheetSet, textSet) {
  const spreadsheetLike = roles.some((role) => spreadsheetSet.has(role));
  const textLike = roles.some((role) => textSet.has(role));
  return { spreadsheetLike, textLike, roles };
}

function probeMacAxFocusSync() {
  const binaryPath = path.join(__dirname, 'ax-focus-probe');
  const scriptPath = path.join(__dirname, 'ax-focus-probe.swift');
  const fs = require('fs');

  const runners = [];
  if (fs.existsSync(binaryPath)) {
    runners.push(() => execFileSync(binaryPath, { encoding: 'utf8', timeout: 1500 }));
  }
  runners.push(() => execFileSync('swift', [scriptPath], { encoding: 'utf8', timeout: 3500 }));

  for (const run of runners) {
    try {
      const raw = run().trim();
      const parsed = JSON.parse(raw);
      if (!parsed?.ok) return { ok: false, platform: 'darwin' };
      return {
        ok: true,
        platform: 'darwin',
        roles: parsed.roles || [],
        spreadsheetLike: !!parsed.spreadsheetLike,
        textLike: !!parsed.textLike,
      };
    } catch {
      // try next runner
    }
  }

  return { ok: false, platform: 'darwin' };
}

function probeWinAxFocusSync() {
  try {
    const raw = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', UIA_FOCUS_SCRIPT],
      { encoding: 'utf8', timeout: 1200, windowsHide: true }
    ).trim();
    const parsed = JSON.parse(raw);
    if (!parsed?.ok) return { ok: false, platform: 'win32' };
    const controlTypes = parsed.controlTypes || [];
    const classified = classifyRoles(controlTypes, WIN_SPREADSHEET_CONTROL_TYPES, WIN_TEXT_CONTROL_TYPES);
    return {
      ok: true,
      platform: 'win32',
      roles: controlTypes,
      spreadsheetLike: !!parsed.spreadsheetLike || classified.spreadsheetLike,
      textLike: !!parsed.textLike || classified.textLike,
    };
  } catch {
    return { ok: false, platform: 'win32' };
  }
}

function probeAxFocusSync() {
  if (process.platform === 'darwin') return probeMacAxFocusSync();
  if (process.platform === 'win32') return probeWinAxFocusSync();
  return { ok: false, platform: process.platform };
}

function probeAxFocusCached(maxAgeMs = 120) {
  const now = Date.now();
  if (lastProbe.result && now - lastProbe.at <= maxAgeMs) {
    return lastProbe.result;
  }
  const result = probeAxFocusSync();
  lastProbe = { at: now, result };
  return result;
}

function isSpreadsheetLikeAxFocus(probe = probeAxFocusCached()) {
  if (!probe?.ok) return false;
  if (probe.spreadsheetLike) return true;
  return (probe.roles || []).some((role) => {
    const value = String(role).toLowerCase();
    return (
      value.includes('table') ||
      value.includes('grid') ||
      value.includes('cell') ||
      value.includes('row') ||
      value.includes('column') ||
      value.includes('outline')
    );
  });
}

function isTextLikeAxFocus(probe = probeAxFocusCached()) {
  return !!probe?.ok && !!probe.textLike;
}

function invalidateAxFocusCache() {
  lastProbe = { at: 0, result: null };
}

module.exports = {
  probeAxFocusSync,
  probeAxFocusCached,
  isSpreadsheetLikeAxFocus,
  isTextLikeAxFocus,
  invalidateAxFocusCache,
  SPREADSHEET_AX_ROLES,
  TEXT_AX_ROLES,
};
