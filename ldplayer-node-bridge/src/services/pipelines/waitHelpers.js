'use strict';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function cancelableSleep(ms, isCancelledFn, stepMs = 250) {
  let waited = 0;
  while (waited < ms) {
    if (isCancelledFn && isCancelledFn()) throw new Error('cancelado');
    const chunk = Math.min(stepMs, ms - waited);
    await sleep(chunk);
    waited += chunk;
  }
}

async function waitForRootReady(client, index, { timeoutMs = 120000, pollMs = 3000, graceMs = 5000, isCancelledFn } = {}) {
  await cancelableSleep(graceMs, isCancelledFn);
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    if (isCancelledFn && isCancelledFn()) throw new Error('cancelado');
    try {
      const status = await client.getRootStatus(index);
      const ready = status?.adb_ready ?? status?.ready ?? status?.online ?? status?.connected ?? false;
      if (ready === true || status?.status === 'ready' || status?.state === 'ready') return status;
    } catch (err) { lastErr = err; }
    await cancelableSleep(pollMs, isCancelledFn);
  }
  throw new Error(`timeout esperando ADB listo (${timeoutMs}ms)` + (lastErr ? ` - ${lastErr.message}` : ''));
}
function _looksReady(health) {
  if (health == null) return false;
  const boolFields = [
    health.tools_available, health.ready, health.online, health.connected,
    health.adb_ready, health.booted,
  ];
  if (boolFields.some((v) => v === true)) return true;
  const strFields = [health.status, health.state];
  if (strFields.some((v) => typeof v === 'string' && ['ok', 'ready', 'running', 'online'].includes(v.toLowerCase()))) {
    return true;
  }
  return false;
}
// Estrategia en dos fases, sin depender del shape de /health (que aparenta ser
// solo batería, con cache TTL propio — no confiable como señal de "boot listo"):
//
// Fase 1: confirmar que la instancia figura "running" según list2 real
//         (GET /instances/:index -> instance_service.get_instance, que sí
//         refleja el parser de `ldconsole list2`).
// Fase 2: probar ADB real con una llamada liviana (getCurrentApp). Mientras
//         el sistema no terminó de bootear, ADB rechaza o tira error; en
//         cuanto responde sin explotar, asumimos que el launcher/UI está arriba.
//
// TODO: si conseguimos el shape real de instance_service.get_health, se puede
// sumar como señal adicional (ej. para chequear batería fake también seteada),
// pero no reemplaza este chequeo de boot.

// Confirmado contra services/instance_service.py: get_instance() devuelve el dict
// crudo de LDConsole.list_instances(), y get_health() copia inst["android_started"]
// de ahí — esa es la señal real y única de "instancia corriendo" (bool).
function _isRunning(instance) {
  return instance != null && instance.android_started === true;
}

async function waitForAndroidReady(client, index, {
  timeoutMs = 90000, pollMs = 2000, graceMs = 3000, isCancelledFn,
  runningTimeoutMs = 30000, // tope aparte solo para la fase "running" de list2
} = {}) {
  await cancelableSleep(graceMs, isCancelledFn);

  // Fase 1: esperar que list2 diga running
  const runningDeadline = Date.now() + runningTimeoutMs;
  let lastInstance = null;
  let lastErr = null;
  while (Date.now() < runningDeadline) {
    if (isCancelledFn && isCancelledFn()) throw new Error('cancelado');
    try {
      const instance = await client.getInstance(index);
      lastInstance = instance;
      if (_isRunning(instance)) break;
    } catch (err) { lastErr = err; }
    await cancelableSleep(pollMs, isCancelledFn);
  }
  if (!_isRunning(lastInstance)) {
    throw new Error(
      `timeout esperando que la instancia figure "running" (${runningTimeoutMs}ms)` +
      (lastInstance ? ` - última respuesta: ${JSON.stringify(lastInstance)}` : '') +
      (lastErr ? ` - último error: ${lastErr.message}` : '')
    );
  }

  // Fase 2: probar ADB real hasta que responda sin error
  const deadline = Date.now() + timeoutMs;
  lastErr = null;
  while (Date.now() < deadline) {
    if (isCancelledFn && isCancelledFn()) throw new Error('cancelado');
    try {
      await client.getCurrentApp(index);
      return { running: true, adbReady: true };
    } catch (err) {
      lastErr = err;
    }
    await cancelableSleep(pollMs, isCancelledFn);
  }
  throw new Error(
    `instancia "running" pero ADB no respondió tras ${timeoutMs}ms` +
    (lastErr ? ` - último error: ${lastErr.message}` : '')
  );
}

async function waitForAppInstalled(client, index, packageName, {
  maxRetries = 3, delay = 5000, reinstallApkPath = null, maxReinstalls = 2, reinstallDelay = 5000, isCancelledFn,
} = {}) {
  let reinstalls = 0;
  for (let attempt = 1; attempt <= maxRetries + maxReinstalls; attempt += 1) {
    if (isCancelledFn && isCancelledFn()) return { ok: false, error: 'cancelado' };
    try {
      const apps = await client.listApps(index, { onlyThirdParty: false });
      const list = Array.isArray(apps) ? apps : apps?.apps || [];
      if (list.some((a) => (a.package_name || a.package || a) === packageName)) {
        return { ok: true, attempts: attempt };
      }
    } catch (_) { /* reintenta */ }
    if (attempt > maxRetries && reinstallApkPath && reinstalls < maxReinstalls) {
      reinstalls += 1;
      try { await client.installApp(index, reinstallApkPath); } catch (_) { /* reintenta igual */ }
      await cancelableSleep(reinstallDelay, isCancelledFn);
      continue;
    }
    await cancelableSleep(delay, isCancelledFn);
  }
  return { ok: false, error: `no se detectó instalado tras ${maxRetries} intento(s)${reinstallApkPath ? ` + ${reinstalls} reinstalación(es)` : ''}` };
}

async function waitForAppForeground(client, index, packageName, {
  maxRetries = 3, delay = 5000, installApkPath = null, maxInstallRetries = 2, installDelay = 5000, isCancelledFn,
} = {}) {
  let installAttempts = 0;
  for (let attempt = 1; attempt <= maxRetries + maxInstallRetries; attempt += 1) {
    if (isCancelledFn && isCancelledFn()) return { ok: false, error: 'cancelado' };
    try { await client.runApp(index, packageName); } catch (_) { /* puede ya estar corriendo */ }
    await cancelableSleep(delay, isCancelledFn);
    try {
      const current = await client.getCurrentApp(index);
      const pkg = current?.package_name || current?.package || current;
      if (pkg === packageName) return { ok: true, totalAttempts: attempt, installAttempts };
    } catch (_) { /* reintenta */ }
    if (attempt > maxRetries && installApkPath && installAttempts < maxInstallRetries) {
      installAttempts += 1;
      try { await client.installApp(index, installApkPath); } catch (_) { /* ignorar */ }
      await cancelableSleep(installDelay, isCancelledFn);
    }
  }
  return { ok: false, error: `no llegó a primer plano tras ${maxRetries} intento(s)${installApkPath ? ` + ${installAttempts} instalación(es)` : ''}` };
}

module.exports = {
  sleep, cancelableSleep,
  waitForRootReady, waitForAndroidReady,
  waitForAppInstalled, waitForAppForeground,
};