'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * Lee los archivos que Python escribe en la carpeta de datos compartida
 * (config.dataDir). Ambos proyectos están en la misma raíz, así que en
 * vez de pedirle status/health a Python por HTTP y guardarlo en un cache
 * en memoria de este lado, este bridge lee directo el mismo archivo del
 * disco que Python ya actualiza solo.
 *
 * La comunicación HTTP con Python sigue existiendo para todo lo que es
 * "en caliente" (acciones, consultas puntuales que no están en el
 * snapshot) — eso vive en ldplayerClient.js y no cambia.
 */
class DataStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.statusFile = path.join(baseDir, 'status', 'all.json');
    this.healthDir = path.join(baseDir, 'health');
    this.configFile = path.join(baseDir, 'config', 'runtime.json');
  }

  _readJson(filePath) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      // ENOENT (todavía no existe, ej. Python recién arrancando) o JSON
      // a medio escribir: tratamos como "no hay dato todavía".
      return null;
    }
  }

  /** { instances: {...}, updated_at: <epoch seconds> } | null */
  readStatusSnapshot() {
    return this._readJson(this.statusFile);
  }

  /** { health: {...}, updated_at: <epoch seconds> } | null */
  readHealth(index) {
    return this._readJson(path.join(this.healthDir, `${index}.json`));
  }

  /** { debug, health_ttl, monitor_interval, updated_at } | null */
  readRuntimeConfig() {
    return this._readJson(this.configFile);
  }
}

module.exports = new DataStore(config.dataDir);
