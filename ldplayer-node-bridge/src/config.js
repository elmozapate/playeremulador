'use strict';
require('dotenv').config();
const path = require('path');
function bool(value, fallback) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}
const config = {
  node: {
    host: process.env.NODE_HOST || '0.0.0.0',
    port: parseInt(process.env.NODE_PORT || '4000', 10),
  },
  python: {
    apiBaseUrl: process.env.PYTHON_API_BASE_URL || 'http://127.0.0.1:8000/api/v1',
    rootUrl: process.env.PYTHON_ROOT_URL || 'http://127.0.0.1:8000',
    requestTimeoutMs: parseInt(process.env.PYTHON_REQUEST_TIMEOUT_MS || '15000', 10),
  },
  pythonProcess: {
    manage: bool(process.env.PYTHON_MANAGE_PROCESS, true),
    pythonBin: process.env.PYTHON_BIN || 'python',
    cwd: process.env.PYTHON_SRC_DIR || path.resolve(__dirname, '..', '..', 'ldplayer-bridge', 'src'),
    host: process.env.PYTHON_HOST || '0.0.0.0',
    port: parseInt(process.env.PYTHON_PORT || '8000', 10),
    env: {
      LDPLAYER_PATH: process.env.LDPLAYER_PATH || '',
      ADB_PATH: process.env.ADB_PATH || '',
      MONITOR_INTERVAL: process.env.PY_MONITOR_INTERVAL || '',
      HEALTH_CACHE_TTL: process.env.PY_HEALTH_CACHE_TTL || '',
      // Se propaga al proceso Python para que ambos apunten SIEMPRE a la
      // misma carpeta de datos compartida, sin depender de que los dos
      // calculen el mismo default por separado.
      LDPLAYER_DATA_DIR: process.env.LDPLAYER_DATA_DIR || '',
    },
    autoStart: bool(process.env.PYTHON_AUTOSTART, true),
    autoRestart: bool(process.env.PYTHON_AUTORESTART, true),
    maxRestartAttempts: parseInt(process.env.PYTHON_MAX_RESTARTS || '5', 10),
    restartBackoffMs: parseInt(process.env.PYTHON_RESTART_BACKOFF_MS || '2000', 10),
    readyTimeoutMs: parseInt(process.env.PYTHON_READY_TIMEOUT_MS || '20000', 10),
    logBufferSize: parseInt(process.env.PYTHON_LOG_BUFFER_SIZE || '500', 10),
  },
  polling: {
    // Ya NO es un intervalo de peticiones HTTP a Python: es cada cuánto
    // este bridge relee el snapshot desde el archivo compartido
    // (dataDir/status/all.json). El intervalo con el que Python
    // efectivamente ACTUALIZA ese archivo se configura del lado Python
    // (runtime_state.monitor_interval / POST /api/debug/monitor-interval).
    intervalMs: parseInt(process.env.STATUS_POLL_INTERVAL_MS || '3000', 10),
  },
  // Carpeta compartida en disco con Python (status/health/logs/config
  // runtime). DEBE apuntar al mismo lugar que LDPLAYER_DATA_DIR del lado
  // Python. Por default: hermana de este proyecto y del bridge Python
  // (ambos junto a /apks en la raíz), ej:
  //
  //   raiz/
  //     emu-bridge/        <- este proyecto (src/config.js vive acá)
  //     ldplayer-bridge/   <- proyecto Python
  //     apks/
  //     ldplayer-data/     <- dataDir
  dataDir: process.env.LDPLAYER_DATA_DIR || path.resolve(__dirname, '..', '..', 'ldplayer-data'),
};
module.exports = config;
