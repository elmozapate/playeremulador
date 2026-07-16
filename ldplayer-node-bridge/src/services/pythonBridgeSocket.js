'use strict';
const WebSocket = require('ws');
const config = require('../config');
const eventBus = require('../utils/eventBus');

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 15000;
const PING_INTERVAL_MS = 20000;
const QUEUE_LIMIT = 200;

function deriveWsUrl() {
  if (config.python.wsUrl) return config.python.wsUrl;
  const root = config.python.rootUrl || 'http://127.0.0.1:8000';
  return root.replace(/^http/i, 'ws').replace(/\/+$/, '') + '/ws/bridge';
}

class PythonBridgeSocket {
  constructor() {
    this.url = deriveWsUrl();
    this.ws = null;
    this.connected = false;
    this._manualClose = false;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._pingTimer = null;
    this._queue = []; // mensajes salientes mientras no hay conexión
  }

  connect() {
    this._manualClose = false;
    this._open();
  }

  _open() {
    if (this.ws) {
      try { this.ws.terminate(); } catch (_) { /* noop */ }
    }
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      this.connected = true;
      this._reconnectAttempts = 0;
      console.log(`[python-bridge] conectado a ${this.url}`);
      eventBus.emit('python:bridge:state', { connected: true });
      this._flushQueue();
      this._startPing();
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_) {
        return;
      }
      if (!msg || typeof msg.type !== 'string' || msg.type === 'pong') return;
      eventBus.emit('python:bridge:message', msg);
      eventBus.emit(`python:bridge:${msg.type}`, msg.payload);
    });

    ws.on('close', () => {
      this.connected = false;
      this._stopPing();
      eventBus.emit('python:bridge:state', { connected: false });
      if (!this._manualClose) this._scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.warn(`[python-bridge] error de conexión: ${err.message}`);
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectAttempts += 1;
    const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * this._reconnectAttempts);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (!this._manualClose) this._open();
    }, backoff);
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => this.send('ping', { ts: Date.now() }), PING_INTERVAL_MS);
  }

  _stopPing() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = null;
  }

  send(type, payload) {
    const msg = JSON.stringify({ type, payload });
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(msg);
        return true;
      } catch (err) {
        console.warn(`[python-bridge] no se pudo enviar: ${err.message}`);
        return false;
      }
    }
    this._queue.push(msg);
    if (this._queue.length > QUEUE_LIMIT) this._queue.shift();
    return false;
  }

  _flushQueue() {
    while (this._queue.length && this.connected) {
      const msg = this._queue.shift();
      try { this.ws.send(msg); } catch (_) { break; }
    }
  }

  isConnected() {
    return this.connected;
  }

  close() {
    this._manualClose = true;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._stopPing();
    if (this.ws) {
      try { this.ws.close(); } catch (_) { /* noop */ }
    }
  }
}

module.exports = new PythonBridgeSocket();