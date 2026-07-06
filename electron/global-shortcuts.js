const { globalShortcut } = require('electron');

let registeredAccelerator = null;

function registerSettingsShortcut(accelerator, onTrigger) {
  if (registeredAccelerator) {
    globalShortcut.unregister(registeredAccelerator);
    registeredAccelerator = null;
  }

  if (!accelerator || !onTrigger) return { ok: true, accelerator: null };

  try {
    const ok = globalShortcut.register(accelerator, onTrigger);
    if (ok) {
      registeredAccelerator = accelerator;
      return { ok: true, accelerator };
    }
    return { ok: false, accelerator };
  } catch (err) {
    console.warn('[shortcut] invalid accelerator:', accelerator, err.message);
    return { ok: false, accelerator, error: err.message };
  }
}

function unregisterAllShortcuts() {
  if (registeredAccelerator) {
    globalShortcut.unregister(registeredAccelerator);
    registeredAccelerator = null;
  }
}

module.exports = {
  registerSettingsShortcut,
  unregisterAllShortcuts,
};
