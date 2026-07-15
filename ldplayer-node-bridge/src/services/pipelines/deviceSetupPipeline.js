'use strict';
const eventBus = require('../../utils/eventBus');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_KNOWN_APPS = [
  { id: 'socks', label: 'SOCKS proxy', apk_path: 'C:\\playeremulador\\apks\\soks.apk', package_name: '' },
  { id: 'earn', label: 'Earn app', apk_path: 'C:\\playeremulador\\apks\\earn.apk', package_name: '' },
  { id: 'monitor', label: 'Monitor (app-debug)', apk_path: 'C:\\playeremulador\\apks\\app-debug.apk', package_name: 'com.chataolutions.app' },
];

const DEFAULT_OPTIONS = {
  apps: DEFAULT_KNOWN_APPS,
  rootReadyTimeoutMs: 120_000, // cuanto esperar máx a que el adb vuelva a estar listo tras el reinicio
  rootPollIntervalMs: 3_000,   // cada cuanto se pregunta
  postRebootGraceMs: 5_000,    // colchón antes de empezar a preguntar (dejar que arranque el reboot)
  stepDelayMs: 1_500,          // pausa entre bluetooth/datos/playprotect
  installDelayMs: 3_000,       // pausa entre cada instalación de apk
  stopOnError: false,          // si un device falla, seguir igual con los demás
};

function emitStep(index, step, status, extra = {}) {
  const payload = { index, step, status, ts: Date.now(), ...extra };
  eventBus.emit('pipeline:step', payload);
  return payload;
}

/**
 * Poll a /instances/:index/root/status hasta que el adb esté listo.
 * OJO: ajustá los nombres de campo (adb_ready/ready/online/status/state) según
 * lo que realmente devuelva tu API de Python — puse varios candidatos comunes.
 */
async function waitForAdbReady(client, index, opts) {
  const deadline = Date.now() + opts.rootReadyTimeoutMs;
  await sleep(opts.postRebootGraceMs);
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const status = await client.getRootStatus(index);
      const ready =
        status?.adb_ready ?? status?.ready ?? status?.online ?? status?.connected ?? false;
      if (ready === true || status?.status === 'ready' || status?.state === 'ready') {
        return status;
      }
    } catch (err) {
      lastErr = err;
    }
    await sleep(opts.rootPollIntervalMs);
  }
  throw new Error(
    `Timeout esperando ADB listo en instancia ${index} (${opts.rootReadyTimeoutMs}ms)` +
      (lastErr ? ` - último error: ${lastErr.message}` : '')
  );
}

async function runSetupForInstance(client, index, options) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results = { index, steps: [], ok: true, error: null };

  const step = async (name, fn) => {
    emitStep(index, name, 'start');
    try {
      const data = await fn();
      results.steps.push({ name, ok: true });
      emitStep(index, name, 'ok', { data });
      return data;
    } catch (err) {
      results.steps.push({ name, ok: false, error: err.message });
      emitStep(index, name, 'error', { error: err.message });
      throw err;
    }
  };

  try {
    // 1. initial-root
    await step('initial-root', () => client.initialRoot(index));

    // 2 y 3. esperar a que reinicie + confirmar adb listo
    await step('wait-adb-ready', () => waitForAdbReady(client, index, opts));
    await sleep(opts.stepDelayMs);

    // 4. bluetooth off
    await step('bluetooth-off', () => client.setBluetooth(index, false));
    await sleep(opts.stepDelayMs);

    // 5. datos móviles off
    await step('mobile-data-off', () => client.setMobileData(index, false));
    await sleep(opts.stepDelayMs);

    // 6. quitar play protect
    await step('play-protect-off', () => client.setPlayProtect(index, true));
    await sleep(opts.stepDelayMs);

    // 7. instalar apps en orden: socks -> earn -> monitor
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
  }

  return results;
}

/**
 * Corre el setup completo sobre uno o varios índices, en secuencia
 * (uno termina -> arranca el siguiente). Si querés concurrencia, avisame
 * y lo cambiamos a Promise.all con un límite.
 */
async function runSetupPipeline(client, indices, options = {}) {
  const list = Array.isArray(indices) ? indices : [indices];
  const opts = { ...DEFAULT_OPTIONS, ...options };
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

module.exports = {
  runSetupPipeline,
  runSetupForInstance,
  waitForAdbReady,
  DEFAULT_KNOWN_APPS,
  DEFAULT_OPTIONS,
};