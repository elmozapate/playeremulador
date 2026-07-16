'use strict';

function post(fn) { return { method: 'post', call: fn }; }
function get(fn) { return { method: 'get', call: fn }; }
const bool = (v) => v === true || v === 'true' || v === '1' || v === 1;

const TOOL_ACTIONS = {
  battery_get: get((c, i) => c.getBattery(i)),
  battery_level: post((c, i, v) => c.setBatteryLevel(i, Number(v.level))),
  battery_status: post((c, i, v) => c.setBatteryStatus(i, v.status)),
  battery_reset: post((c, i) => c.resetBattery(i)),

  bluetooth_get: get((c, i) => c.getBluetooth(i)),
  bluetooth_set: post((c, i, v) => c.setBluetooth(i, bool(v.enable))),
  wifi_get: get((c, i) => c.getWifi(i)),
  wifi_set: post((c, i, v) => c.setWifi(i, bool(v.enable))),
  mobile_data: post((c, i, v) => c.setMobileData(i, bool(v.enable))),
  airplane_mode: post((c, i, v) => c.setAirplaneMode(i, bool(v.enable))),
  gps_set: post((c, i, v) => c.setGps(i, bool(v.enable))),
  geo_set: post((c, i, v) => c.simulateGeo(i, v.lat, v.lon)),

  rotation_lock: post((c, i, v) => c.setRotationLock(i, bool(v.locked))),
  brightness: post((c, i, v) => c.setBrightness(i, Number(v.level))),
  screen_timeout: post((c, i, v) => c.setScreenTimeout(i, Number(v.ms))),
  volume: post((c, i, v) => c.setVolume(i, v.stream || 'music', Number(v.level))),
  dnd: post((c, i, v) => c.setDnd(i, bool(v.enable))),
  screen_on: post((c, i) => c.screenOn(i)),
  screen_off: post((c, i) => c.screenOff(i)),
  screen_get: get((c, i) => c.getScreenStatus(i)),

  input_key: post((c, i, v) => c.pressKey(i, v.keycode)),
  input_text: post((c, i, v) => c.inputText(i, v.text)),
  input_tap: post((c, i, v) => c.tap(i, Number(v.x), Number(v.y))),
  input_swipe: post((c, i, v) =>
    c.swipe(i, Number(v.x1), Number(v.y1), Number(v.x2), Number(v.y2), Number(v.duration_ms) || 300)),
  input_long_press: post((c, i, v) =>
    c.longPress(i, Number(v.x), Number(v.y), Number(v.duration_ms) || 800)),

  apps_uninstall: post((c, i, v) => c.uninstallApp(i, v.package_name)),
  apps_force_stop: post((c, i, v) => c.forceStopApp(i, v.package_name)),
  apps_clear_data: post((c, i, v) => c.clearAppData(i, v.package_name)),
  apps_list: get((c, i, v) => c.listApps(i, { onlyThirdParty: v.only_third_party !== 'false' })),
  apps_current: get((c, i) => c.getCurrentApp(i)),
  play_protect: post((c, i, v) => c.setPlayProtect(i, bool(v.disable))),
  permission_grant: post((c, i, v) => c.grantPermission(i, v.package_name, v.permission)),
  permission_revoke: post((c, i, v) => c.revokePermission(i, v.package_name, v.permission)),

  root_status: get((c, i) => c.getRootStatus(i)),
  root_check: get((c, i) => c.checkRoot(i)),
  root_ensure: get((c, i) => c.ensureRoot(i)),
  uid_get: get((c, i) => c.getUid(i)),
};

function findToolAction(name) {
  return TOOL_ACTIONS[name] || null;
}

module.exports = { TOOL_ACTIONS, findToolAction };