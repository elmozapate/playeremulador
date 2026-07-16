'use strict';
const config = require('../config');
class LDPlayerApiError extends Error {
  constructor(message, { status, detail, url, method } = {}) {
    super(message);
    this.name = 'LDPlayerApiError';
    this.status = status;
    this.detail = detail;
    this.url = url;
    this.method = method;
  }
}
class LDPlayerClient {
  constructor({ apiBaseUrl, rootUrl, timeoutMs } = {}) {
    this.apiBaseUrl = (apiBaseUrl || config.python.apiBaseUrl).replace(/\/+$/, '');
    this.rootUrl = (rootUrl || config.python.rootUrl).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs || config.python.requestTimeoutMs;
  }
  async _request(method, path, { body, baseUrl, timeoutMs } = {}) {
    const base = baseUrl || this.apiBaseUrl;
    const url = `${base}${path}`;
    const timeout = timeoutMs ?? this.timeoutMs; // Usa el específico o el global
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(config.python.apiKey ? { 'x-api-key': config.python.apiKey } : {}),
        }, body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new LDPlayerApiError(`Timeout llamando a ${method} ${url}`, { url, method });
      }
      throw new LDPlayerApiError(`No se pudo conectar con el servicio Python: ${err.message}`, {
        url,
        method,
      });
    }
    clearTimeout(timer);
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const detail = (data && data.detail) || res.statusText;
      throw new LDPlayerApiError(`${method} ${path} -> ${res.status}: ${detail}`, {
        status: res.status,
        detail,
        url,
        method,
      });
    }
    return data;
  }
  async ping() {
    try {
      await this._request('GET', '/', { baseUrl: this.rootUrl });
      return true;
    } catch {
      return false;
    }
  }
  listInstances() {
    return this._request('GET', '/instances');
  }
  getInstance(index) {
    return this._request('GET', `/instances/${index}`);
  }
  launch(index) {
    return this._request('POST', `/instances/${index}/launch`);
  }
  reboot(index) {
    return this._request('POST', `/instances/${index}/reboot`);
  }
  quit(index) {
    return this._request('POST', `/instances/${index}/quit`);
  }
  quitAllInstances() {
    return this._request('POST', '/instances/quitall');
  }
  getHealth(index) {
    return this._request('GET', `/instances/${index}/health`);
  }
  installApp(index, apkPath) {
    return this._request('POST', `/instances/${index}/install`, { body: { apk_path: apkPath } });
  }
  runApp(index, packageName) {
    return this._request('POST', `/instances/${index}/run`, { body: { package_name: packageName } });
  }
  modify(index, { cpu, memory, resolution } = {}) {
    return this._request('POST', `/instances/${index}/modify`, {
      body: { cpu: cpu ?? null, memory: memory ?? null, resolution: resolution ?? null },
    });
  }
  clone(index, newName) {
    return this._request('POST', `/instances/${index}/clone`, {
      body: { new_name: newName ?? null },
    });
  }
  killApp(index, packageName) {
    return this._request('POST', `/instances/${index}/kill`, {
      body: { package_name: packageName },
    });
  }
  getAllStatus() {
    return this._request('GET', '/status/all');
  }
  getInstanceStatus(index) {
    return this._request('GET', `/status/${index}`);
  }
  getBattery(index) {
    return this._request('GET', `/instances/${index}/battery`);
  }
  setBatteryLevel(index, level) {
    return this._request('POST', `/instances/${index}/battery/level`, { body: { level } });
  }
  setBatteryStatus(index, status) {
    return this._request('POST', `/instances/${index}/battery/status`, { body: { status } });
  }
  resetBattery(index) {
    return this._request('POST', `/instances/${index}/battery/reset`);
  }
  setBluetooth(index, enable) {
    return this._request('POST', `/instances/${index}/bluetooth`, { body: { enable } });
  }
  getBluetooth(index) {
    return this._request('GET', `/instances/${index}/bluetooth`);
  }
  setWifi(index, enable) {
    return this._request('POST', `/instances/${index}/wifi`, { body: { enable } });
  }
  getWifi(index) {
    return this._request('GET', `/instances/${index}/wifi`);
  }
  setMobileData(index, enable) {
    return this._request('POST', `/instances/${index}/mobile-data`, { body: { enable } });
  }
  setAirplaneMode(index, enable) {
    return this._request('POST', `/instances/${index}/airplane-mode`, { body: { enable } });
  }
  setGps(index, enable) {
    return this._request('POST', `/instances/${index}/gps`, { body: { enable } });
  }
  simulateGeo(index, lat, lon) {
    return this._request('POST', `/instances/${index}/geo`, { body: { lat, lon } });
  }
  setRotationLock(index, locked) {
    return this._request('POST', `/instances/${index}/rotation-lock`, { body: { locked } });
  }
  setBrightness(index, level) {
    return this._request('POST', `/instances/${index}/brightness`, { body: { level } });
  }
  setScreenTimeout(index, ms) {
    return this._request('POST', `/instances/${index}/screen-timeout`, { body: { ms } });
  }
  setVolume(index, stream, level) {
    return this._request('POST', `/instances/${index}/volume`, { body: { stream, level } });
  }
  setDnd(index, enable) {
    return this._request('POST', `/instances/${index}/dnd`, { body: { enable } });
  }
  screenOn(index) {
    return this._request('POST', `/instances/${index}/screen/on`);
  }
  screenOff(index) {
    return this._request('POST', `/instances/${index}/screen/off`);
  }
  getScreenStatus(index) {
    return this._request('GET', `/instances/${index}/screen`);
  }
  pressKey(index, keycode) {
    return this._request('POST', `/instances/${index}/input/key`, { body: { keycode } });
  }
  inputText(index, text) {
    return this._request('POST', `/instances/${index}/input/text`, { body: { text } });
  }
  tap(index, x, y) {
    return this._request('POST', `/instances/${index}/input/tap`, { body: { x, y } });
  }
  swipe(index, x1, y1, x2, y2, durationMs = 300) {
    return this._request('POST', `/instances/${index}/input/swipe`, {
      body: { x1, y1, x2, y2, duration_ms: durationMs },
    });
  }
  longPress(index, x, y, durationMs = 800) {
    return this._request('POST', `/instances/${index}/input/long-press`, {
      body: { x, y, duration_ms: durationMs },
    });
  }
  uninstallApp(index, packageName) {
    return this._request('POST', `/instances/${index}/apps/uninstall`, {
      body: { package_name: packageName },
    });
  }
  forceStopApp(index, packageName) {
    return this._request('POST', `/instances/${index}/apps/force-stop`, {
      body: { package_name: packageName },
    });
  }
  clearAppData(index, packageName) {
    return this._request('POST', `/instances/${index}/apps/clear-data`, {
      body: { package_name: packageName },
    });
  }
  listApps(index, { onlyThirdParty = true } = {}) {
    const qs = onlyThirdParty === false ? '?only_third_party=false' : '';
    return this._request('GET', `/instances/${index}/apps${qs}`);
  }
  getCurrentApp(index) {
    return this._request('GET', `/instances/${index}/apps/current`);
  }
  grantPermission(index, packageName, permission) {
    return this._request('POST', `/instances/${index}/apps/permissions/grant`, {
      body: { package_name: packageName, permission },
    });
  }
  revokePermission(index, packageName, permission) {
    return this._request('POST', `/instances/${index}/apps/permissions/revoke`, {
      body: { package_name: packageName, permission },
    });
  }
  setPlayProtect(index, disable) {
    return this._request('POST', `/instances/${index}/apps/play-protect`, { body: { disable } });
  }
  runAppReliable(index, packageName, { activity, timeoutS = 6.0 } = {}) {
    return this._request('POST', `/instances/${index}/apps/run-reliable`, {
      body: { package_name: packageName, activity: activity ?? null, timeout_s: timeoutS },
    });
  }
  getRootStatus(index) {
    return this._request('GET', `/instances/${index}/root/status`);
  }
  checkRoot(index) {
    return this._request('GET', `/instances/${index}/root/check`);
  }
  ensureRoot(index) {
    return this._request('GET', `/instances/${index}/root/ensure`);
  }
  getUid(index) {
    return this._request('GET', `/instances/${index}/uid`);
  }
  rootShell(index, command) {
    return this._request('POST', `/instances/${index}/root/shell`, {
      body: { command },
    });
  }
  initialRoot(index) {
    return this._request('POST', `/instances/${index}/initial-root`, { timeoutMs: 120000 });
    return this._request('POST', `/instances/${index}/initial-root`);
  }
  makeReady(index) {
    return this._request('POST', `/instances/${index}/ready`);
  }
  warmup(indices = [0, 1, 2], timeoutSec = 120) {
  return this._request('POST', '/system/warmup', {
    body: { indices, timeout_sec: timeoutSec },
  });
}
  // ====================================================================
  // Debug / configuración runtime del servicio Python (modo verbose,
  // TTL del health cache, intervalo del monitor). Todo se persiste en
  // disco del lado Python (ver core/runtime_state.py).
  // ====================================================================
  getDebugStatus() {
    return this._request('GET', '/debug/status');
  }
  getLastSession() {
    return this._request('GET', '/debug/system/last-session');
  }
  shutdownSnapshot() {
    return this._request('POST', '/debug/system/shutdown-snapshot');
  }
  toggleDebug(enable) {
    return this._request('POST', '/debug/toggle', { body: { enable } });
  }
  setHealthTtl(seconds) {
    return this._request('POST', '/debug/health-ttl', { body: { seconds } });
  }
  setMonitorInterval(seconds) {
    return this._request('POST', '/debug/monitor-interval', { body: { seconds } });
  }
}
module.exports = { LDPlayerClient, LDPlayerApiError };
