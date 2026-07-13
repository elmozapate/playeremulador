'use strict';

require('dotenv').config();
const path = require('path');

function bool(value, fallback) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const config = {
  // --- Servidor Node (el que habla con la interfaz HTML) ---
  node: {
    host: process.env.NODE_HOST || '0.0.0.0',
    port: parseInt(process.env.NODE_PORT || '4000', 10),
  },

  // --- API Python (FastAPI / ldplayer-bridge) ---
  python: {
    // Base de la API versionada (todo lo de instances/status vive acá)
    apiBaseUrl: process.env.PYTHON_API_BASE_URL || 'http://127.0.0.1:8000/api/v1',
    // Raíz del servicio, solo para healthcheck (GET /)
    rootUrl: process.env.PYTHON_ROOT_URL || 'http://127.0.0.1:8000',
    // Timeout por request HTTP hacia Python (ms)
    requestTimeoutMs: parseInt(process.env.PYTHON_REQUEST_TIMEOUT_MS || '15000', 10),
  },

  // --- Gestión del proceso Python (levantar/parar uvicorn desde Node) ---
  pythonProcess: {
    // Si false, Node asume que el servicio Python ya corre por afuera
    // (systemd, docker, o lo levantaste vos a mano) y solo lo consume por HTTP.
    manage: bool(process.env.PYTHON_MANAGE_PROCESS, true),
    // Ejecutable de Python (puede apuntar a un venv: /path/venv/Scripts/python.exe)
    pythonBin: process.env.PYTHON_BIN || 'python',
    // Carpeta donde vive main.py del proyecto FastAPI (src/ del ldplayer-bridge)
    cwd: process.env.PYTHON_SRC_DIR || path.resolve(__dirname, '..', '..', 'ldplayer-bridge', 'src'),
    host: process.env.PYTHON_HOST || '0.0.0.0',
    port: parseInt(process.env.PYTHON_PORT || '8000', 10),
    // Variables de entorno que se le pasan al proceso Python al spawnearlo
    env: {
      LDPLAYER_PATH: process.env.LDPLAYER_PATH || '',
      ADB_PATH: process.env.ADB_PATH || '',
      MONITOR_INTERVAL: process.env.PY_MONITOR_INTERVAL || '',
      HEALTH_CACHE_TTL: process.env.PY_HEALTH_CACHE_TTL || '',
    },
    autoStart: bool(process.env.PYTHON_AUTOSTART, true),
    autoRestart: bool(process.env.PYTHON_AUTORESTART, true),
    maxRestartAttempts: parseInt(process.env.PYTHON_MAX_RESTARTS || '5', 10),
    restartBackoffMs: parseInt(process.env.PYTHON_RESTART_BACKOFF_MS || '2000', 10),
    readyTimeoutMs: parseInt(process.env.PYTHON_READY_TIMEOUT_MS || '20000', 10),
    logBufferSize: parseInt(process.env.PYTHON_LOG_BUFFER_SIZE || '500', 10),
  },

  // --- Polling de estado para reenviar por SSE a la interfaz HTML ---
  polling: {
    intervalMs: parseInt(process.env.STATUS_POLL_INTERVAL_MS || '3000', 10),
  },
};

module.exports = config;
