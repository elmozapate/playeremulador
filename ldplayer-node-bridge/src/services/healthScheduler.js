'use strict';
const config = require('../config');
const eventBus = require('../utils/eventBus');
const jobStore = require('./pipelines/jobStore');
const { runJob } = require('./pipelines/jobRunner');
const { buildPreset } = require('./pipelines/presets');
const instanceModelStore = require('./instanceModelStore');

class HealthScheduler {
  constructor(client, poller, opts = {}) {
    this.client = client;
    this.poller = poller;
    this.opts = { ...config.healthCheck, ...opts };
    this._timer = null;
    this._running = false;
    this._queue = [];
    this._cursor = 0;
    this._currentIndex = null;
    this._lastTickAt = null;
    this._lastResult = null;
    this._nextTickAt = null;
  }
  getStatus() {
    return {
      enabled: this.opts.enabled,
      running: this._running,
      intervalMs: this.opts.intervalMs,
      queue: [...this._queue],
      cursor: this._cursor,
      currentIndex: this._currentIndex,
      lastTickAt: this._lastTickAt,
      lastResult: this._lastResult,
      nextTickAt: this._nextTickAt,
    };
  }
  setInterval(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 1000) {
      throw new Error('intervalMs debe ser un número >= 1000');
    }
    this.opts.intervalMs = n;
    if (this._running) {
      if (this._timer) clearTimeout(this._timer);
      this._scheduleNext();
    }
    return this.getStatus();
  }
  async runNow() {
    if (this._timer) clearTimeout(this._timer);
    await this._tick();
    return this.getStatus();
  }
  start({ force = false } = {}) {
    if ((!this.opts.enabled && !force) || this._running) return this.getStatus();
    this._running = true;
    this.opts.enabled = true;
    this._scheduleNext();
    console.log(`[health] round-robin activado: 1 instancia cada ${this.opts.intervalMs}ms`);
    return this.getStatus();
  }
  stop() {
    this._running = false;
    this.opts.enabled = false;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this._nextTickAt = null;
    this._currentIndex = null;
    return this.getStatus();
  }
  _scheduleNext() {
    if (!this._running) return;
    this._nextTickAt = Date.now() + this.opts.intervalMs;
    this._timer = setTimeout(() => this._tick(), this.opts.intervalMs);
  }

  async _getActiveIndices() {
    const snapshot = this.poller.getLastSnapshot();
    const instances = snapshot?.instances;
    if (instances && typeof instances === 'object' && Object.keys(instances).length) {
      return Object.keys(instances).map(Number).filter(Number.isFinite);
    }
    try {
      const list = await this.client.listInstances();
      const arr = Array.isArray(list) ? list : list?.instances || [];
      return arr.map((i) => i.index ?? i.Index ?? i.idx).filter((n) => Number.isFinite(n));
    } catch (err) {
      console.warn(`[health] no se pudo obtener la lista de instancias: ${err.message}`);
      return [];
    }
  }

  _syncQueue(indices) {
    const sorted = [...indices].sort((a, b) => a - b);
    this._queue = this._queue.filter((i) => sorted.includes(i));
    for (const i of sorted) {
      if (!this._queue.includes(i)) this._queue.push(i);
    }
  }

  _nextIndex() {
    if (this._queue.length === 0) return null;
    const index = this._queue[this._cursor % this._queue.length];
    this._cursor = (this._cursor + 1) % this._queue.length;
    return index;
  }

  async _runJobAndWait(presetId, params, index) {
    const preset = buildPreset(presetId, params);
    const job = jobStore.createJob({
      name: preset.name,
      steps: preset.steps,
      indices: [index],
      parallel: false,
      meta: { presetId, scheduled: true },
    });
    eventBus.emit('job:created', { jobId: job.id, name: job.name, indices: job.indices });
    await runJob(this.client, job.id);
    return job.instances[index];
  }
  async _tick() {
    this._lastTickAt = Date.now();
    let index = null;
    try {
      const indices = await this._getActiveIndices();
      if (indices.length === 0) {
        console.log('[health] sin instancias activas, se salta este ciclo');
        this._lastResult = { ok: true, skipped: true, reason: 'sin-instancias' };
        return;
      }
      this._syncQueue(indices);
      index = this._nextIndex();
      if (index === null) return;
      this._currentIndex = index;
      const { action } = instanceModelStore.decideHealthAction(index);
      if (action === 'skip-never-started' || action === 'skip-expected-off' || action === 'skip-unknown') {
        console.log(`[health] instancia ${index}: ${action}, se salta este turno`);
        this._lastResult = { ok: true, index, skipped: true, reason: action };
        return;
      }
      if (action === 'relaunch') {
        console.log(`[health] instancia ${index}: se apagó sin orden -> relanzando antes de chequear`);
        try {
          await this.client.launch(index);
        } catch (err) {
          console.warn(`[health] no se pudo relanzar instancia ${index}: ${err.message}`);
          this._lastResult = { ok: false, index, reason: 'relaunch-failed', error: err.message };
          return;
        }
      }
      console.log(`[health] instancia ${index}: iniciando chequeo`);
      const result = await this._runJobAndWait('health_check', {}, index);
      if (result.status === 'done') {
        console.log(`[health] instancia ${index}: chequeo OK (monitor en primer plano + batería respondió)`);
        this._lastResult = { ok: true, index, reason: 'chequeo-ok' };
        return;
      }
      console.warn(`[health] instancia ${index}: chequeo falló (status=${result.status}) -> ejecutando recuperación`);
      const recovery = await this._runJobAndWait('health_recovery', {}, index);
      console.log(`[health] instancia ${index}: recuperación finalizada con estado=${recovery.status}`);
      this._lastResult = { ok: recovery.status === 'done', index, reason: 'recuperacion', status: recovery.status };
    } catch (err) {
      console.error(`[health] error en el chequeo del turno: ${err.message}`);
      this._lastResult = { ok: false, index, reason: 'error', error: err.message };
    } finally {
      this._currentIndex = null;
      this._scheduleNext();
    }
  }
}

module.exports = HealthScheduler;