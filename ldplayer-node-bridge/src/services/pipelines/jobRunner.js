// jobRunner.js (corregido)
'use strict';
const eventBus = require('../../utils/eventBus');
const { STEP_TYPES } = require('./stepTypes');
const { waitForAndroidReady, cancelableSleep } = require('./waitHelpers');
const jobStore = require('./jobStore');

class Mutex {
  constructor() { this._locked = false; this._queue = []; }
  acquire(timeoutMs = 5 * 60_000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const tryAcquire = () => {
        if (settled) return;
        if (!this._locked) {
          settled = true;
          if (timer) clearTimeout(timer);
          this._locked = true;
          resolve(() => this._release());
        } else {
          this._queue.push(tryAcquire);
        }
      };
      if (timeoutMs) {
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          const i = this._queue.indexOf(tryAcquire);
          if (i !== -1) this._queue.splice(i, 1);
          reject(new Error(`timeout esperando el mutex de power (${timeoutMs}ms)`));
        }, timeoutMs);
      }
      tryAcquire();
    });
  }
  _release() {
    this._locked = false;
    const next = this._queue.shift();
    if (next) next();
  }
}
const powerMutex = new Mutex();
const powerReleasers = new Map(); // index -> release fn

function buildCtx(client, job, index) {
  return {
    client,
    log(msg) {
      eventBus.emit('job:log', { jobId: job.id, index, ts: Date.now(), msg: String(msg) });
    },
    isCancelled() { return job.cancelled; },
    sleep(ms) { return cancelableSleep(ms, () => job.cancelled); },
    async acquirePower(idx) {
      const release = await powerMutex.acquire(5 * 60_000);
      powerReleasers.set(idx, release);
    },
    releasePower(idx) {
      const release = powerReleasers.get(idx);
      if (release) { release(); powerReleasers.delete(idx); }
    },
    waitForBoot(idx, timeoutMs) {
      return waitForAndroidReady(client, idx, { timeoutMs, isCancelledFn: () => job.cancelled });
    },
  };
}

// ✅ Ahora recibe el cliente como parámetro
async function warmupBeforeJob(client, indices = [0, 1, 2]) {
  console.log('🔥 Calentando instancias... (puede tomar 2 minutos)');
  try {
    const result = await client._request('POST', '/system/warmup', {
      body: { indices, timeout_sec: 120 },
      timeoutMs: 180000,
    });
    console.log('✅ Calentamiento completado:', result.results);
    return true;
  } catch (err) {
    console.error('❌ Falló el calentamiento:', err.message);
    return false;
  }
}

async function runInstance(client, job, index) {
  const inst = job.instances[index];
  inst.status = 'running';
  eventBus.emit('job:instance:status', { jobId: job.id, index, status: 'running' });
  const ctx = buildCtx(client, job, index);

  try {
    for (const step of job.steps) {
      if (job.cancelled) {
        inst.status = 'cancelled';
        eventBus.emit('job:instance:status', { jobId: job.id, index, status: 'cancelled' });
        return;
      }
      const def = STEP_TYPES[step.type];
      inst.currentStep = step.type;
      eventBus.emit('job:step', { jobId: job.id, index, step: step.type, status: 'start', ts: Date.now() });

      if (!def) {
        inst.steps.push({ type: step.type, ok: false, detail: 'tipo de step desconocido' });
        eventBus.emit('job:step', { jobId: job.id, index, step: step.type, status: 'error', detail: 'tipo desconocido' });
        inst.status = 'failed';
        eventBus.emit('job:instance:status', { jobId: job.id, index, status: 'failed' });
        return;
      }

      let result;
      try {
        result = await def.exec(index, step.values || {}, ctx);
      } catch (err) {
        result = { ok: false, detail: err.message, abort: true };
      }
      inst.steps.push({ type: step.type, ...result });
      eventBus.emit('job:step', {
        jobId: job.id, index, step: step.type,
        status: result.ok ? 'ok' : 'error', detail: result.detail, ts: Date.now(),
      });

      if (!result.ok && result.abort) {
        inst.status = 'aborted';
        eventBus.emit('job:instance:status', { jobId: job.id, index, status: 'aborted' });
        return;
      }
    }
    inst.currentStep = null;
    inst.status = 'done';
    eventBus.emit('job:instance:status', { jobId: job.id, index, status: 'done' });
  } finally {
    // ✅ Liberación segura del mutex para este índice
    if (powerReleasers.has(index)) {
      ctx.releasePower(index);
    }
  }
}

async function runJob(client, jobId) {
  const job = jobStore.getJob(jobId);
  if (!job) throw new Error('job no encontrado');
  job.status = 'running';
  job.startedAt = Date.now();
  eventBus.emit('job:started', { jobId: job.id, ts: job.startedAt });
  try {
    if (job.parallel) {
      await Promise.all(job.indices.map((index) => runInstance(client, job, index)));
    } else {
      for (const index of job.indices) {
        if (job.cancelled) break;
        await runInstance(client, job, index);
      }
    }
    job.status = job.cancelled ? 'cancelled' : 'done';
  } catch (err) {
    job.status = 'error';
    job.error = err.message;
  } finally {
    job.finishedAt = Date.now();
    eventBus.emit(job.cancelled ? 'job:cancelled' : 'job:done', { jobId: job.id, ts: job.finishedAt, status: job.status });
  }
  return job;
}

function cancelJob(jobId) {
  const job = jobStore.getJob(jobId);
  if (!job) return null;
  job.cancelled = true;
  return job;
}

module.exports = { runJob, cancelJob, warmupBeforeJob };