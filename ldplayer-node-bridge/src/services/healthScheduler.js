'use strict';
const config = require('../config');
const eventBus = require('../utils/eventBus');
const jobStore = require('./pipelines/jobStore');
const { runJob } = require('./pipelines/jobRunner');
const { buildPreset } = require('./pipelines/presets');

class HealthScheduler {
  constructor(client, poller, opts = {}) {
    this.client = client;
    this.poller = poller;
    this.opts = { ...config.healthCheck, ...opts };
    this._timer = null;
    this._running = false;
  }
  start() {
    if (!this.opts.enabled || this._running) return;
    this._running = true;
    this._scheduleNext();
    console.log(`[health] chequeo periódico activado cada ${this.opts.intervalMs}ms (en cadena, no paralelo)`);
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
  async _tick() {
    try {
      const indices = await this._getActiveIndices();
      if (indices.length === 0) {
        console.log('[health] sin instancias activas, se salta este ciclo');
        return;
      }
      const preset = buildPreset('health', {
        package_name: this.opts.packageName || undefined,
        apk_path: this.opts.apkPath || undefined,
      });
      const job = jobStore.createJob({
        name: preset.name,
        steps: preset.steps,
        indices,
        parallel: false, // en cadena: una instancia después de la otra
        meta: { presetId: 'health', scheduled: true },
      });
      eventBus.emit('job:created', { jobId: job.id, name: job.name, indices: job.indices });
      console.log(`[health] chequeo programado jobId=${job.id} indices=${JSON.stringify(indices)}`);
      await runJob(this.client, job.id);
      console.log(`[health] chequeo programado jobId=${job.id} finalizado con estado=${job.status}`);
    } catch (err) {
      console.error(`[health] error en el chequeo programado: ${err.message}`);
    } finally {
      this._scheduleNext();
    }
  }
}
module.exports = HealthScheduler;