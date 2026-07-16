'use strict';
const eventBus = require('../../utils/eventBus');
const appsConfigStore = require('../appsConfigStore');
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// La lista de apps ya NO está hardcodeada acá: sale de
// appsConfigStore.readApps() (persistida en ldplayer-data/config/apps.json,
// editable vía /api/config/apps). Se mantiene el export DEFAULT_KNOWN_APPS
// por compatibilidad, apuntando a los mismos defaults.
const DEFAULT_KNOWN_APPS = appsConfigStore.DEFAULT_APPS;
const DEFAULT_OPTIONS = {
    rootReadyTimeoutMs: 120_000, 
    rootPollIntervalMs: 3_000,   
    postRebootGraceMs: 5_000,    
    stepDelayMs: 1_500,          
    installDelayMs: 3_000,       
    stopOnError: false,          
};
function emitStep(index, step, status, extra = {}) {
    const payload = { index, step, status, ts: Date.now(), ...extra };
    eventBus.emit('pipeline:step', payload);
    return payload;
}
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
    // apps: si no viene explícito en `options`, se toma la config
    // persistida (o los defaults si nunca se editó nada).
    const opts = { ...DEFAULT_OPTIONS, apps: appsConfigStore.readApps(), ...options };
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
        await step('initial-root', () => client.initialRoot(index));
        await step('initial-root-reboot', () => client.reboot(index));
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
    }
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
module.exports = {
    runSetupPipeline,
    runSetupForInstance,
    waitForAdbReady,
    DEFAULT_KNOWN_APPS,
    DEFAULT_OPTIONS,
};