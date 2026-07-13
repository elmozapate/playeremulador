'use strict';

const config = require('../config');
const eventBus = require('../utils/eventBus');

/**
 * Sondea GET /status/all del servicio Python cada `intervalMs` y emite:
 *  - 'status:update' { instances, ts }   siempre que la llamada sea exitosa
 *  - 'status:error'   { message, ts }     si el servicio Python no responde
 *
 * La interfaz HTML no necesita pollear directo al backend Python: se suscribe
 * al SSE de Node (sseHub) y este servicio es quien empuja los cambios.
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
      const instances = await this.client.getAllStatus();
      this.lastSnapshot = { instances, ts: Date.now() };
      eventBus.emit('status:update', this.lastSnapshot);
    } catch (err) {
      eventBus.emit('status:error', { message: err.message, ts: Date.now() });
    } finally {
      if (this._running) {
        this._timer = setTimeout(() => this._tick(), this.intervalMs);
      }
    }
  }

  /** Fuerza un refresh inmediato (ej: después de un launch/quit desde la UI). */
  async refreshNow() {
    if (this._timer) clearTimeout(this._timer);
    await this._tick();
  }

  getLastSnapshot() {
    return this.lastSnapshot;
  }
}

module.exports = StatusPoller;
