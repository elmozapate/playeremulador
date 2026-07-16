'use strict';

// Ajustá acá las rutas/packages reales si cambian.
const KNOWN_APPS = {
  socks: { id: 'socks', label: 'SOCKS proxy', apk_path: 'C:\\playeremulador\\apks\\soks.apk', package_name: 'net.typeblog.socks' },
  earn: { id: 'earn', label: 'Earn app', apk_path: 'C:\\playeremulador\\apks\\earn.apk', package_name: 'com.brd.earnrewards' },
  monitor: { id: 'monitor', label: 'Monitor (app-debug)', apk_path: 'C:\\playeremulador\\apks\\app-debug.apk', package_name: 'com.chataolutions.app' },
};

function installStep(app, extra = {}) {
  return { type: 'install', values: { apk_path: app.apk_path, package_name: app.package_name, ...extra } };
}
function runStep(app, extra = {}) {
  return { type: 'run', values: { package_name: app.package_name, apk_path: app.apk_path, ...extra } };
}
function killStep(app) {
  return { type: 'kill', values: { package_name: app.package_name } };
}

const PRESETS = {
  encendido: () => ({
    name: 'Encendido en cadena',
    steps: [
      { type: 'launch', values: { bootTimeoutSec: 90 } },
      { type: 'wait', values: { seconds: 5 } },
    ],
  }),

  instalacion: () => ({
    name: 'Cadena de instalación',
    steps: [
      { type: 'launch', values: { bootTimeoutSec: 90 } },
      installStep(KNOWN_APPS.socks),
      { type: 'wait', values: { seconds: 10 } },
      installStep(KNOWN_APPS.earn),
      { type: 'wait', values: { seconds: 10 } },
      { type: 'quit', values: {} },
      { type: 'wait', values: { seconds: 15 } },
    ],
  }),

  monitor: () => ({
    name: 'Iniciar con monitor',
    steps: [
      { type: 'launch', values: { bootTimeoutSec: 90 } },
      { type: 'wait', values: { seconds: 10 } },
      installStep(KNOWN_APPS.monitor),
      { type: 'wait', values: { seconds: 10 } },
      runStep(KNOWN_APPS.monitor),
      { type: 'wait', values: { seconds: 10 } },
      killStep(KNOWN_APPS.monitor),
      { type: 'wait', values: { seconds: 15 } },
      { type: 'quit', values: {} },
      { type: 'wait', values: { seconds: 15 } },
    ],
  }),

  setup_completo: () => ({
    name: 'Setup completo (Root + Apps)',
    steps: [
      { type: 'initial_root', values: {} },
      { type: 'wait_root_ready', values: { timeoutSec: 120, pollSec: 3, graceSec: 5 } },
      { type: 'wait', values: { seconds: 5 } },
      { type: 'tool', values: { tool_action: 'bluetooth_set', enable: 'false' } },
      { type: 'wait', values: { seconds: 2 } },
      { type: 'tool', values: { tool_action: 'mobile_data', enable: 'false' } },
      { type: 'wait', values: { seconds: 2 } },
      { type: 'tool', values: { tool_action: 'play_protect', disable: 'true' } },
      { type: 'wait', values: { seconds: 2 } },
      installStep(KNOWN_APPS.socks),
      { type: 'wait', values: { seconds: 3 } },
      installStep(KNOWN_APPS.earn),
      { type: 'wait', values: { seconds: 3 } },
      installStep(KNOWN_APPS.monitor),
    ],
  }),

  setup_root_adb: () => ({
    name: 'Root Inicial + ADB',
    steps: [
      { type: 'launch', values: { bootTimeoutSec: 90 } },
      { type: 'wait', values: { seconds: 5 } },
      { type: 'initial_root', values: {} },
      { type: 'wait_root_ready', values: { timeoutSec: 120, pollSec: 3, graceSec: 5 } },
      { type: 'wait', values: { seconds: 10 } },
      { type: 'quit', values: {} },
    ],
  }),

  setup_apps: () => ({
    name: 'Setup Apps (instalación)',
    steps: [
      { type: 'launch', values: { bootTimeoutSec: 90 } },
      { type: 'wait', values: { seconds: 5 } },
      { type: 'tool', values: { tool_action: 'bluetooth_set', enable: 'false' } },
      { type: 'wait', values: { seconds: 2 } },
      { type: 'tool', values: { tool_action: 'mobile_data', enable: 'false' } },
      { type: 'wait', values: { seconds: 2 } },
      { type: 'tool', values: { tool_action: 'play_protect', disable: 'true' } },
      { type: 'wait', values: { seconds: 10 } },
      installStep(KNOWN_APPS.socks),
      { type: 'wait', values: { seconds: 10 } },
      installStep(KNOWN_APPS.earn),
      { type: 'wait', values: { seconds: 10 } },
      installStep(KNOWN_APPS.monitor),
      { type: 'wait', values: { seconds: 10 } },
      { type: 'quit', values: {} },
    ],
  }),

  // params: { server_url, name_prefix }
  registro_health: ({ server_url, name_prefix } = {}) => ({
    name: 'Registro Health (nombre + server)',
    steps: [
      { type: 'launch', values: { bootTimeoutSec: 90 } },
      { type: 'wait', values: { seconds: 10 } },
      runStep(KNOWN_APPS.monitor),
      { type: 'wait', values: { seconds: 10 } },
      { type: 'tool', values: { tool_action: 'input_key', keycode: 'D' } },
      { type: 'wait', values: { seconds: 2 } },
      { type: 'tool', values: { tool_action: 'input_text', text: `${name_prefix || 'LDPlayer-00'}{index}` } },
      { type: 'wait', values: { seconds: 2 } },
      { type: 'tool', values: { tool_action: 'input_key', keycode: 'TAB' } },
      { type: 'wait', values: { seconds: 2 } },
      { type: 'tool', values: { tool_action: 'input_key', keycode: 'ENTER' } },
      { type: 'wait', values: { seconds: 2 } },
      { type: 'tool', values: { tool_action: 'input_key', keycode: 'ESCAPE' } },
      { type: 'wait', values: { seconds: 2 } },
      { type: 'tool', values: { tool_action: 'input_key', keycode: 'S' } },
      { type: 'wait', values: { seconds: 2 } },
      { type: 'tool', values: { tool_action: 'input_text', text: server_url || '' } },
      { type: 'wait', values: { seconds: 2 } },
      { type: 'tool', values: { tool_action: 'input_key', keycode: 'TAB' } },
      { type: 'wait', values: { seconds: 2 } },
      { type: 'tool', values: { tool_action: 'input_key', keycode: 'ENTER' } },
      { type: 'wait', values: { seconds: 2 } },
      { type: 'tool', values: { tool_action: 'input_key', keycode: 'ESCAPE' } },
      { type: 'wait', values: { seconds: 5 } },
      killStep(KNOWN_APPS.monitor),
      { type: 'quit', values: {} },
    ],
  }),
};

function listPresets() {
  return Object.keys(PRESETS).map((id) => ({ id, name: PRESETS[id]().name }));
}

function buildPreset(id, params) {
  const factory = PRESETS[id];
  if (!factory) return null;
  return factory(params || {});
}

module.exports = { KNOWN_APPS, PRESETS, listPresets, buildPreset };
