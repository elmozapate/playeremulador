'use strict';
const config = require('../config');
/**
 * Error tipado para respuestas no-2xx de la API Python.
 * FastAPI devuelve {"detail": "..."} en sus HTTPException, lo exponemos tal cual.
 */
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
/**
 * Cliente 1:1 contra la API de ldplayer-bridge (FastAPI).
 * Cada método corresponde exactamente a una ruta del backend Python:
 *
 *   GET    /api/v1/instances                    -> listInstances()
 *   POST   /api/v1/instances/quitall             -> quitAllInstances()
 *   GET    /api/v1/instances/{index}             -> getInstance(index)
 *   POST   /api/v1/instances/{index}/launch      -> launch(index)
 *   POST   /api/v1/instances/{index}/reboot      -> reboot(index)
 *   POST   /api/v1/instances/{index}/quit        -> quit(index)
 *   GET    /api/v1/instances/{index}/health      -> getHealth(index)
 *   POST   /api/v1/instances/{index}/install     -> installApp(index, apkPath)
 *   POST   /api/v1/instances/{index}/run         -> runApp(index, packageName)
 *   POST   /api/v1/instances/{index}/modify      -> modify(index, { cpu, memory, resolution })
 *   GET    /api/v1/status/all                    -> getAllStatus()
 *   GET    /api/v1/status/{index}                -> getInstanceStatus(index)
 *   GET    /                                      -> ping()
 *
 * Métodos de sistema (api/system.py del lado Python), todos bajo el mismo
 * prefix /instances/{index}/... :
 *   battery, bluetooth, wifi, mobile-data, airplane-mode, gps, geo,
 *   rotation-lock, brightness, screen-timeout, volume, dnd, screen,
 *   input/*, apps/* (uninstall, force-stop, clear-data, list, current,
 *   permissions, play-protect, run-reliable)
 */
class LDPlayerClient {
  constructor({ apiBaseUrl, rootUrl, timeoutMs } = {}) {
    this.apiBaseUrl = (apiBaseUrl || config.python.apiBaseUrl).replace(/\/+$/, '');
    this.rootUrl = (rootUrl || config.python.rootUrl).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs || config.python.requestTimeoutMs;
  }
  async _request(method, path, { body, baseUrl } = {}) {
    const base = baseUrl || this.apiBaseUrl;
    const url = `${base}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
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
  // ---- Healthcheck de servicio ------------------------------------------
  async ping() {
    try {
      await this._request('GET', '/', { baseUrl: this.rootUrl });
      return true;
    } catch {
      return false;
    }
  }
  // ---- Instancias ---------------------------------------------------------
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
  /**
   * @param {number} index
   * @param {{cpu?: number, memory?: number, resolution?: string}} params resolution: "width,height,dpi"
   */
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
  // ---- Status (cache del monitor de background en Python) -----------------
  getAllStatus() {
    return this._request('GET', '/status/all');
  }
  getInstanceStatus(index) {
    return this._request('GET', `/status/${index}`);
  }

  // ==========================================================================
  // Sistema: batería
  // ==========================================================================
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

  // ==========================================================================
  // Sistema: radios
  // ==========================================================================
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

  // ==========================================================================
  // Sistema: ubicación / sensores
  // ==========================================================================
  setGps(index, enable) {
    return this._request('POST', `/instances/${index}/gps`, { body: { enable } });
  }
  simulateGeo(index, lat, lon) {
    return this._request('POST', `/instances/${index}/geo`, { body: { lat, lon } });
  }
  setRotationLock(index, locked) {
    return this._request('POST', `/instances/${index}/rotation-lock`, { body: { locked } });
  }

  // ==========================================================================
  // Sistema: interfaz (pantalla, volumen, DND)
  // ==========================================================================
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

  // ==========================================================================
  // Sistema: input (teclas, texto, gestos)
  // ==========================================================================
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

  // ==========================================================================
  // Sistema: apps extra (no cubiertas por /instances/{index}/{install,run,kill})
  // ==========================================================================
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
  /**
   * Variante robusta de runApp: confirma foreground vía ADB y hace fallback
   * automático si ldconsole runapp no lo logra en timeoutS segundos.
   * @param {number} index
   * @param {string} packageName
   * @param {{activity?: string, timeoutS?: number}} opts
   */
  runAppReliable(index, packageName, { activity, timeoutS = 6.0 } = {}) {
    return this._request('POST', `/instances/${index}/apps/run-reliable`, {
      body: { package_name: packageName, activity: activity ?? null, timeout_s: timeoutS },
    });
  }
}
module.exports = { LDPlayerClient, LDPlayerApiError };