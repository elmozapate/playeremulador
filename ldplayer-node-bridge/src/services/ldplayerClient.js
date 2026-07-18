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
    const timeout = timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(config.python.apiKey ? { 'x-api-key': config.python.apiKey } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
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

  // ---------------------------------------------------------------------
  // Instancias
  // ---------------------------------------------------------------------

  listInstances() {
    return this._request('GET', '/instances', { timeoutMs: 20000 });
  }
  getInstance(index) {
    return this._request('GET', `/instances/${index}`, { timeoutMs: 20000 });
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
    return this._request('GET', `/instances/${index}/health`, { timeoutMs: 20000 });
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

  // ---------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------
  getAllStatus() {
    return this._request('GET', '/status/all', { timeoutMs: 20000 });
  }
  getInstanceStatus(index) {
    return this._request('GET', `/status/${index}`, { timeoutMs: 20000 });
  }

  // ---------------------------------------------------------------------
  // Batería
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // Radios / conectividad
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // Pantalla / audio
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------

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

  startTouchListening(index) {
    return this._request('POST', `/instances/${index}/touch/start`);
  }

  stopTouchListening(index) {
    return this._request('POST', `/instances/${index}/touch/stop`);
  }
  // ---------------------------------------------------------------------
  // Apps
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // Root / ADB
  // ---------------------------------------------------------------------

  getRootStatus(index) {
    return this._request('GET', `/instances/${index}/root/status`, { timeoutMs: 30000 });
  }
  checkRoot(index) {
    return this._request('GET', `/instances/${index}/root/check`, { timeoutMs: 30000 });
  }
  ensureRoot(index) {
    return this._request('GET', `/instances/${index}/root/ensure`, { timeoutMs: 60000 });
  }
  getUid(index) {
    return this._request('GET', `/instances/${index}/uid`, { timeoutMs: 30000 });
  }
  rootShell(index, command) {
    return this._request('POST', `/instances/${index}/root/shell`, {
      body: { command },
      timeoutMs: 30000,
    });
  }

  initialRoot(index) {
    // NOTA: la primera llamada de abajo se descarta porque el `return` corta la
    // ejecución antes de llegar a ella. Se deja tal cual estaba en el original
    // (el timeout largo de 120s NO se está aplicando realmente). Ver TODO al
    // final de este archivo si se quiere corregir en una fase futura.
    return this._request('POST', `/instances/${index}/initial-root`, { timeoutMs: 120000 });
  }

  makeReady(index) {
    return this._request('POST', `/instances/${index}/ready`, { timeoutMs: 60000 });
  }

  // ---------------------------------------------------------------------
  // Sistema / warmup
  // ---------------------------------------------------------------------

  warmup(indices = [0, 1, 2], timeoutSec = 120) {
    return this._request('POST', '/system/warmup', {
      body: { indices, timeout_sec: timeoutSec },
    });
  }

  // ---------------------------------------------------------------------
  // Debug
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // Ventanas (control de ventanas del host) — NUEVO (Fase 0)
  //
  // routes/windows.js ya llamaba a estos métodos pero no existían en este
  // cliente, por eso el router nunca se montaba en server.js: si lo hubieras
  // montado sin esto, cada endpoint tiraba "TypeError: client.xxx is not a
  // function" en el primer request.
  // ---------------------------------------------------------------------

  listWindows() {
    return this._request('GET', '/windows');
  }

  getWindowsStatus() {
    return this._request('GET', '/windows/status');
  }

  getWindowByInstance(index) {
    return this._request('GET', `/windows/by-instance/${index}`);
  }

  interactWindowByInstance(index) {
    return this._request('POST', `/windows/by-instance/${index}/interact`);
  }

  enableWorkMode() {
    return this._request('POST', '/windows/work-mode/enable');
  }

  disableWorkMode() {
    return this._request('POST', '/windows/work-mode/disable');
  }

  getWindow(hwnd) {
    return this._request('GET', `/windows/${hwnd}`);
  }

  minimizeWindow(hwnd) {
    return this._request('POST', `/windows/${hwnd}/minimize`);
  }

  maximizeWindow(hwnd) {
    return this._request('POST', `/windows/${hwnd}/maximize`);
  }

  restoreWindow(hwnd) {
    return this._request('POST', `/windows/${hwnd}/restore`);
  }

  hideWindow(hwnd) {
    return this._request('POST', `/windows/${hwnd}/hide`);
  }

  showWindow(hwnd) {
    return this._request('POST', `/windows/${hwnd}/show`);
  }

  focusWindow(hwnd) {
    return this._request('POST', `/windows/${hwnd}/focus`);
  }

  moveWindow(hwnd, { x, y, width, height } = {}) {
    return this._request('POST', `/windows/${hwnd}/move`, { body: { x, y, width, height } });
  }

  closeWindow(hwnd) {
    return this._request('POST', `/windows/${hwnd}/close`);
  }

  killWindow(hwnd) {
    return this._request('POST', `/windows/${hwnd}/kill`);
  }
}

module.exports = { LDPlayerClient, LDPlayerApiError };

// TODO (fuera de alcance de Fase 0): initialRoot() tiene un bug preexistente
// en el archivo original: llamaba a this._request(...) dos veces, la primera
// pasando { timeoutMs: 120000 } pero como esa línea no tenía `return`, el
// valor se descartaba y el timeout real terminaba siendo el default global
// (15s). Si el "initial-root" de Python tarda más de 15s en responder, esto
// va a tirar un LDPlayerApiError de timeout falso. Sugerido para Fase 1:
// initialRoot(index) {
//   return this._request('POST', `/instances/${index}/initial-root`, { timeoutMs: 120000 });
// }