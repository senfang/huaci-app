const { app } = require('electron');
const path = require('path');

function getWinLoginOptions() {
  const options = { path: process.execPath, args: [] };
  if (!app.isPackaged) {
    options.args = [path.resolve(__dirname, '..')];
  }
  return options;
}

function buildLoginSettings(enabled) {
  const settings = { openAtLogin: !!enabled };

  if (process.platform === 'darwin') {
    settings.openAsHidden = true;
  }

  if (process.platform === 'win32') {
    Object.assign(settings, getWinLoginOptions());
  }

  return settings;
}

function applyLaunchAtLogin(enabled) {
  app.setLoginItemSettings(buildLoginSettings(enabled));
}

function getLaunchAtLogin() {
  if (process.platform === 'win32') {
    return app.getLoginItemSettings(getWinLoginOptions()).openAtLogin;
  }
  return app.getLoginItemSettings().openAtLogin;
}

function syncLaunchAtLogin(configEnabled) {
  const desired = !!configEnabled;
  const current = getLaunchAtLogin();
  if (current !== desired) {
    applyLaunchAtLogin(desired);
  }
  return desired;
}

module.exports = {
  applyLaunchAtLogin,
  getLaunchAtLogin,
  syncLaunchAtLogin,
};
