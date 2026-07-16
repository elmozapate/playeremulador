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
    wsUrl: process.env.PYTHON_WS_URL || null, // si no se define, se deriva de rootUrl + /ws/bridge
    apiKey: process.env.PYTHON_API_KEY || '',
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
    intervalMs: parseInt(process.env.STATUS_POLL_INTERVAL_MS || '3000', 10),
  },
  healthCheck: {
    enabled: bool(process.env.HEALTH_CHECK_ENABLED, true),
    // 10 minutos por defecto
    intervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '600000', 10),
    // vacío = usa KNOWN_APPS.monitor (com.chataolutions.app) del preset
    packageName: process.env.HEALTH_CHECK_PACKAGE || '',
    apkPath: process.env.HEALTH_CHECK_APK_PATH || '',
  },
  dataDir: process.env.LDPLAYER_DATA_DIR || path.resolve(__dirname, '..', '..', 'ldplayer-data'),
};
module.exports = config;