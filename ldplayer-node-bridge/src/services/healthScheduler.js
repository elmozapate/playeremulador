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
    this._queue = [];   // orden estable de índices a rotar
    this._cursor = 0;   // puntero round-robin
  }

  start() {
    if (!this.opts.enabled || this._running) return;
    this._running = true;
    this._scheduleNext();
    console.log(`[health] round-robin activado: 1 instancia cada ${this.opts.intervalMs}ms`);
  }

  stop() {
    this._running = false;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }

  _scheduleNext() {
    if (!this._running) return;
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
    try {
      const indices = await this._getActiveIndices();
      if (indices.length === 0) {
        console.log('[health] sin instancias activas, se salta este ciclo');
        return;
      }
      this._syncQueue(indices);
      const index = this._nextIndex();
      if (index === null) return;

      const { action } = instanceModelStore.decideHealthAction(index);

      if (action === 'skip-never-started' || action === 'skip-expected-off' || action === 'skip-unknown') {
        console.log(`[health] instancia ${index}: ${action}, se salta este turno`);
        return;
      }
      if (action === 'relaunch') {
        console.log(`[health] instancia ${index}: se apagó sin orden -> relanzando antes de chequear`);
        try {
          await this.client.launch(index);
        } catch (err) {
          console.warn(`[health] no se pudo relanzar instancia ${index}: ${err.message}`);
          return; // no tiene sentido chequear si ni siquiera prendió
        }
      }

      console.log(`[health] instancia ${index}: iniciando chequeo`);
      const result = await this._runJobAndWait('health_check', {}, index);

      if (result.status === 'done') {
        console.log(`[health] instancia ${index}: chequeo OK (monitor en primer plano + batería respondió)`);
        return;
      }

      console.warn(`[health] instancia ${index}: chequeo falló (status=${result.status}) -> ejecutando recuperación`);
      const recovery = await this._runJobAndWait('health_recovery', {}, index);
      console.log(`[health] instancia ${index}: recuperación finalizada con estado=${recovery.status}`);
    } catch (err) {
      console.error(`[health] error en el chequeo del turno: ${err.message}`);
    } finally {
      this._scheduleNext();
    }
  }
}

module.exports = HealthScheduler;