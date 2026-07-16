'use strict';
const config = require('../config');
const eventBus = require('../utils/eventBus');
const dataStore = require('./dataStore');

/**
 * Antes: pedía /status/all por HTTP a Python cada intervalo y guardaba
 * el resultado en un cache en memoria de este lado.
 *
 * Ahora: Python escribe el snapshot en dataDir/status/all.json y este
 * poller simplemente lo relee del disco — sin red, y sin un cache propio
 * más allá de "lastSnapshot" en memoria para servir instantáneo por SSE
 * (el dato real y persistente es el archivo, que sobrevive un reinicio
 * de cualquiera de los dos procesos).
 *
 * Si el archivo todavía no existe (arranque en frío, antes del primer
 * ciclo del monitor de Python) se hace un único fallback puntual por
 * HTTP para no dejar el status vacío mientras tanto.
 */
class StatusPoller {
  constructor(client, { intervalMs } = {}) {
    this.client = client;
    this.intervalMs = intervalMs || config.polling.intervalMs;
    this._timer = null;
    this._running = false;
    this.lastSnapshot = null;
  }
  start() {
    if (this._running) return;
    this._running = true;
    this._tick();
  }
  stop() {
    this._running = false;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }
  async _tick() {
    if (!this._running) return;
    try {
      const fromDisk = dataStore.readStatusSnapshot();
      if (fromDisk) {
        this.lastSnapshot = {
          instances: fromDisk.instances || {},
          ts: fromDisk.updated_at ? Math.round(fromDisk.updated_at * 1000) : Date.now(),
        };
      } else {
        const instances = await this.client.getAllStatus();
        this.lastSnapshot = { instances, ts: Date.now() };
      }
      eventBus.emit('status:update', this.lastSnapshot);
    } catch (err) {
      eventBus.emit('status:error', { message: err.message, ts: Date.now() });
    } finally {
      if (this._running) {
        this._timer = setTimeout(() => this._tick(), this.intervalMs);
      }
    }
  }
  async refreshNow() {
    if (this._timer) clearTimeout(this._timer);
    await this._tick();
  }
  getLastSnapshot() {
    return this.lastSnapshot;
  }
}
module.exports = StatusPoller;
