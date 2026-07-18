'use strict';
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
  // ------------------------------------------------------------------
  // NUEVO: chequeo de salud periódico por instancia. Diseñado para
  // correr en cadena (parallel:false) sobre instancias YA encendidas.
  //
  // Revisa:   estado root/ADB, batería, bluetooth, app en primer plano.
  // Compara:  root debe seguir activo; bluetooth debe seguir apagado
  //           (lo apaga el setup); la app objetivo debe estar en
  //           foreground.
  // Corrige:  el step 'run' ya relanza (y reinstala si hace falta) la
  //           app objetivo si no está en primer plano — no hace falta
  //           lógica condicional extra, waitForAppForeground ya hace
  //           el check+fix en un solo step.
  // ------------------------------------------------------------------
  health: ({ package_name, apk_path } = {}) => {
    const target = {
      package_name: package_name || KNOWN_APPS.monitor.package_name,
      apk_path: apk_path || KNOWN_APPS.monitor.apk_path,
    };
    return {
      name: 'Chequeo de salud',
      steps: [
        { type: 'tool', values: { tool_action: 'root_status' } },
        { type: 'verify', values: { tool_action: 'root_check', expect_path: 'root', expect_value: true } },
        { type: 'tool', values: { tool_action: 'battery_get' } },
        { type: 'verify', values: { tool_action: 'bluetooth_get', expect_path: 'enabled', expect_value: false } },
        { type: 'tool', values: { tool_action: 'apps_current' } },
        { type: 'run', values: { package_name: target.package_name } },
        { type: 'note', values: { text: `Chequeo de salud completo (${target.package_name})` } },
      ],
    };
  },
  // en services/pipelines/presets.js, dentro del objeto PRESETS:

  health_check: () => ({
    name: 'Chequeo de salud (monitor)',
    steps: [
      { type: 'quit', values: {} },
      { type: 'wait', values: { seconds: 3 } },
      { type: 'launch', values: { bootTimeoutSec: 90 } },
      { type: 'run', values: { package_name: KNOWN_APPS.monitor.package_name } },
      { type: 'wait', values: { seconds: 1 } },
      { type: 'run', values: { package_name: KNOWN_APPS.socks.package_name } },
      { type: 'wait', values: { seconds: 1 } },
      { type: 'tool', values: { tool_action: 'input_tap', x: 419, y: 73 } },
      { type: 'wait', values: { seconds: 1 } },
      { type: 'run', values: { package_name: KNOWN_APPS.earn.package_name } },
      { type: 'wait', values: { seconds: 1 } },
      {
        type: 'verify',
        values: {
          tool_action: 'apps_current',
          expect_path: 'package_name',
          expect_value: KNOWN_APPS.earn.package_name,
          // sin on_mismatch:'abort' a propósito: es el último paso,
          // queremos que quede registrado ok:false si falló, sin cortar el job
        },
      },
    ],
  }),

  health_recovery: () => ({
    name: 'Recuperación de salud (quit + launch + pipeline)',
    steps: [
      { type: 'quit', values: {} },
      { type: 'wait', values: { seconds: 3 } },
      { type: 'launch', values: { bootTimeoutSec: 90 } },
      { type: 'run', values: { package_name: KNOWN_APPS.monitor.package_name } },
      { type: 'wait', values: { seconds: 1 } },
      { type: 'kill', values: { package_name: KNOWN_APPS.monitor.package_name } },
      { type: 'wait', values: { seconds: 5 } },
      { type: 'run', values: { package_name: KNOWN_APPS.socks.package_name } },
      { type: 'wait', values: { seconds: 1 } },
      { type: 'tool', values: { tool_action: 'input_tap', x: 419, y: 73 } },
      { type: 'wait', values: { seconds: 1 } },
      { type: 'kill', values: { package_name: KNOWN_APPS.socks.package_name } },
      { type: 'wait', values: { seconds: 1 } },
      { type: 'run', values: { package_name: KNOWN_APPS.earn.package_name } },
      { type: 'wait', values: { seconds: 1 } },
      {
        type: 'verify',
        values: {
          tool_action: 'apps_current',
          expect_path: 'package_name',
          expect_value: KNOWN_APPS.earn.package_name,
          // sin on_mismatch:'abort' a propósito: es el último paso,
          // queremos que quede registrado ok:false si falló, sin cortar el job
        },
      },
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