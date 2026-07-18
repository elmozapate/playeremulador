'use strict';
const eventBus = require('../../utils/eventBus');
const appsConfigStore = require('../appsConfigStore');
const { instanceRecordStore } = require('../instanceRecordStore');
const { waitForAndroidReady } = require('./waitHelpers');
const { powerMutex } = require('./jobRunner');

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
const DEFAULT_KNOWN_APPS = appsConfigStore.DEFAULT_APPS;
const DEFAULT_OPTIONS = {
  rootReadyTimeoutMs: 120_000,
  rootPollIntervalMs: 3_000,
  postRebootGraceMs: 5_000,
  stepDelayMs: 1_500,
  installDelayMs: 3_000,
  stopOnError: false,
  launchBootTimeoutMs: 90_000,
  stepRetries: 2,
  stepRetryDelayMs: 5_000,
  powerAcquireTimeoutMs: 10 * 60_000,
};

function emitStep(index, step, status, extra = {}) {
  const payload = { index, step, status, ts: Date.now(), ...extra };
  eventBus.emit('pipeline:step', payload);
  return payload;
}
function notifyAction(action, index, result) {
  eventBus.emit('instance:action', { action, index, result, ts: Date.now() });
}

async function waitForAdbReady(client, index, opts) {
  const deadline = Date.now() + opts.rootReadyTimeoutMs;
  await sleep(opts.postRebootGraceMs);
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const status = await client.getRootStatus(index);
      const ready = status?.adb_ready ?? status?.ready ?? status?.online ?? status?.connected ?? false;
      if (ready === true || status?.status === 'ready' || status?.state === 'ready') return status;
    } catch (err) { lastErr = err; }
    await sleep(opts.rootPollIntervalMs);
  }
  throw new Error(`Timeout esperando ADB listo en instancia ${index} (${opts.rootReadyTimeoutMs}ms)` + (lastErr ? ` - último error: ${lastErr.message}` : ''));
}

// step() ahora reintenta antes de fallar de verdad
async function runSetupForInstance(client, index, options) {
  const opts = { ...DEFAULT_OPTIONS, apps: appsConfigStore.readApps(), ...options };
  const results = { index, steps: [], ok: true, error: null };
  let recordTaskId = null;
  try { recordTaskId = await instanceRecordStore.addTask(index, 'pipeline:setup', { steps: [] }); } catch (err) { emitStep(index, 'record-store', 'error', { error: err.message }); }

  const syncRecord = async (status) => {
    if (!recordTaskId) return;
    try { await instanceRecordStore.updateTask(index, recordTaskId, status, { steps: results.steps, error: results.error }); } catch (err) { emitStep(index, 'record-store', 'error', { error: err.message }); }
  };

  const step = async (name, fn, { retries, retryDelayMs } = {}) => {
    const maxRetries = retries ?? opts.stepRetries;
    const delayMs = retryDelayMs ?? opts.stepRetryDelayMs;
    emitStep(index, name, 'start');
    let lastErr = null;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      try {
        const data = await fn();
        results.steps.push({ name, ok: true, attempt });
        emitStep(index, name, 'ok', { data, attempt });
        await syncRecord('running');
        return data;
      } catch (err) {
        lastErr = err;
        if (attempt <= maxRetries) {
          emitStep(index, name, 'retry', { error: err.message, attempt, nextAttempt: attempt + 1 });
          await sleep(delayMs);
        }
      }
    }
    results.steps.push({ name, ok: false, error: lastErr.message });
    emitStep(index, name, 'error', { error: lastErr.message });
    await syncRecord('running');
    throw lastErr;
  };

  let releasePower = null;
  try {
    // nadie más puede encender/rootear otra instancia mientras esta usa el mutex
    emitStep(index, 'power-wait', 'start');
    releasePower = await powerMutex.acquire(opts.powerAcquireTimeoutMs);
    emitStep(index, 'power-wait', 'ok');

    await step('launch', () => client.launch(index));
    notifyAction('launch', index, true);

    await step('wait-android-ready', () => waitForAndroidReady(client, index, {
      timeoutMs: opts.launchBootTimeoutMs,
      runningTimeoutMs: 30_000,
      graceMs: opts.postRebootGraceMs,
    }));

    await step('initial-root', () => client.initialRoot(index), { retries: 0 });
    await step('initial-root-reboot', () => client.reboot(index), { retries: 0 });
    await sleep(opts.stepDelayMs);
    await step('wait-adb-ready', () => waitForAdbReady(client, index, opts));
    await sleep(opts.stepDelayMs);
    await step('bluetooth-off', () => client.setBluetooth(index, false));
    await sleep(opts.stepDelayMs);
    await step('mobile-data-off', () => client.setMobileData(index, false));
    await sleep(opts.stepDelayMs);
    await step('play-protect-off', () => client.setPlayProtect(index, true));
    await sleep(opts.stepDelayMs);

    for (const app of opts.apps) {
      await step(`install:${app.id}`, () => client.installApp(index, app.apk_path));
      await sleep(opts.installDelayMs);
    }

    results.ok = true;
    emitStep(index, 'pipeline', 'done');
  } catch (err) {
    results.ok = false;
    results.error = err.message;
    emitStep(index, 'pipeline', 'failed', { error: err.message });
  } finally {
    // pase lo que pase, cerramos la instancia antes de soltar el mutex
    try {
      await client.quit(index);
      notifyAction('quit', index, true);
    } catch (err) {
      emitStep(index, 'quit', 'error', { error: err.message });
    }
    if (releasePower) releasePower();
  }

  await syncRecord(results.ok ? 'done' : 'failed');
  return results;
}

async function runSetupPipeline(client, indices, options = {}) {
  const list = Array.isArray(indices) ? indices : [indices];
  const opts = { ...DEFAULT_OPTIONS, apps: appsConfigStore.readApps(), ...options };
  const summary = [];
  eventBus.emit('pipeline:batch', { status: 'start', indices: list, ts: Date.now() });
  for (const index of list) {
    const result = await runSetupForInstance(client, index, opts);
    summary.push(result);
    if (!result.ok && opts.stopOnError) {
      eventBus.emit('pipeline:batch', { status: 'stopped-on-error', index, ts: Date.now() });
      break;
    }
  }
  eventBus.emit('pipeline:batch', { status: 'done', summary, ts: Date.now() });
  return summary;
}

module.exports = { runSetupPipeline, runSetupForInstance, waitForAdbReady, DEFAULT_KNOWN_APPS, DEFAULT_OPTIONS };