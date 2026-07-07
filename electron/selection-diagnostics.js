const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let logPath = '';
let stream = null;
const counters = Object.create(null);
let lastEventAt = Object.create(null);
let reproMarker = 0;

function init() {
  if (stream) return logPath;
  try {
    logPath = path.join(app.getPath('userData'), 'selection-debug.log');
    stream = fs.createWriteStream(logPath, { flags: 'a' });
    write(`===== session ${app.getVersion()} pid=${process.pid} =====`);
  } catch (err) {
    console.error('[diagnostics] init failed', err);
  }
  return logPath;
}

function write(message, data) {
  if (!stream) return;
  const suffix = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  stream.write(`[${new Date().toISOString()}] ${message}${suffix}\n`);
}

function log(message, data) {
  init();
  write(message, data);
}

function count(name) {
  counters[name] = (counters[name] || 0) + 1;
  lastEventAt[name] = Date.now();
}

function mark(name) {
  count(name);
  log(`event ${name}`, getStats());
}

function getStats() {
  return {
    reproMarker,
    counters: { ...counters },
    lastEventAt: { ...lastEventAt },
  };
}

function markReproStart(label = 'user marked repro start') {
  reproMarker += 1;
  log('===== REPRO START =====', { marker: reproMarker, label, ...getStats() });
}

function logPhase(phase, data) {
  log(`phase ${phase}`, { ...data, ...getStats() });
}

function logHeartbeat(data) {
  log('heartbeat', { ...data, ...getStats() });
}

function getLogPath() {
  init();
  return logPath;
}

module.exports = {
  log,
  count,
  mark,
  getStats,
  markReproStart,
  logPhase,
  logHeartbeat,
  getLogPath,
};
