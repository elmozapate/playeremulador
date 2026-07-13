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
  // ---- Status (cache del monitor de background en Python) -----------------
  getAllStatus() {
    return this._request('GET', '/status/all');
  }

  getInstanceStatus(index) {
    return this._request('GET', `/status/${index}`);
  }

  killApp(index, packageName) {
    return this._request('POST', `/instances/${index}/kill`, {
      body: { package_name: packageName }
    });
  }
}

module.exports = { LDPlayerClient, LDPlayerApiError };
