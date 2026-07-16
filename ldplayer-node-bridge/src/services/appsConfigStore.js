'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * Config de las apps que usa el pipeline de setup (deviceSetupPipeline.js).
 * Antes vivía hardcodeada como DEFAULT_KNOWN_APPS dentro del pipeline; acá
 * se persiste en disco para poder editarla sin tocar código y para que
 * sobreviva reinicios.
 *
 * OJO: a diferencia de status/health/runtime.json (que escribe Python),
 * este archivo lo escribe y lee SOLO Node — vive en la misma carpeta
 * compartida (ldplayer-data/config/) porque es el mismo "cajón" de
 * config, pero es dominio de Node (el pipeline que instala apps corre
 * acá, y las rutas de apks son las que ya maneja este bridge).
 */
const CONFIG_FILE = path.join(config.dataDir, 'config', 'apps.json');

const DEFAULT_APPS = [
  { id: 'socks', label: 'SOCKS proxy', apk_path: 'C:\\playeremulador\\apks\\soks.apk', package_name: '' },
  { id: 'earn', label: 'Earn app', apk_path: 'C:\\playeremulador\\apks\\earn.apk', package_name: '' },
  { id: 'monitor', label: 'Monitor (app-debug)', apk_path: 'C:\\playeremulador\\apks\\app-debug.apk', package_name: 'com.chataolutions.app' },
];

function _ensureDir() {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
}

function _writeAtomic(filePath, data) {
  _ensureDir();
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function _validateApp(app) {
  if (!app || typeof app.id !== 'string' || !app.id.trim()) {
    throw new Error('cada app necesita un "id" (string) único');
  }
  if (typeof app.apk_path !== 'string' || !app.apk_path.trim()) {
    throw new Error(`la app "${app.id}" necesita "apk_path"`);
  }
}

/** Devuelve el array de apps configurado. Si todavía no hay archivo
 * (primer arranque) devuelve DEFAULT_APPS sin escribir nada — recién se
 * persiste cuando alguien lo edita por API. */
function readApps() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.apps)) return parsed.apps;
    return DEFAULT_APPS;
  } catch (err) {
    return DEFAULT_APPS;
  }
}

/** Reemplaza la lista completa. */
function writeApps(apps) {
  if (!Array.isArray(apps)) throw new Error('"apps" debe ser un array');
  apps.forEach(_validateApp);
  const ids = apps.map((a) => a.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('los "id" de las apps deben ser únicos');
  }
  _writeAtomic(CONFIG_FILE, { apps, updated_at: Date.now() });
  return apps;
}

/** Agrega o actualiza una sola app (por id) sin tocar el resto. */
function upsertApp(app) {
  _validateApp(app);
  const apps = readApps();
  const idx = apps.findIndex((a) => a.id === app.id);
  const entry = {
    id: app.id,
    label: app.label || app.id,
    apk_path: app.apk_path,
    package_name: app.package_name || '',
  };
  if (idx >= 0) apps[idx] = entry;
  else apps.push(entry);
  return writeApps(apps);
}

/** Borra una app por id. */
function removeApp(id) {
  const apps = readApps();
  const next = apps.filter((a) => a.id !== id);
  if (next.length === apps.length) {
    const e = new Error(`No existe una app con id "${id}"`);
    e.status = 404;
    throw e;
  }
  return writeApps(next);
}

module.exports = { readApps, writeApps, upsertApp, removeApp, DEFAULT_APPS, CONFIG_FILE };