'use strict';
// deviceRegistry.js
//
// Reemplaza a agentHealth.js. Guarda el estado "completo" de cada dispositivo/emulador
// que habla con el bridge: identidad (deviceId), correlación con el índice de LDPlayer
// (instanceIndex), metadata (appVersion, user-agent), apks activas, proxies, y un mini
// historial de apps usadas. Todo en memoria (Map), mismo patrón que el resto de servicios.
//
// Flujo de registro:
//   1) El cliente (app dentro del emulador) llama POST /api/agent/register la PRIMERA vez
//      que se conecta (no manda deviceId, no lo tiene todavía).
//   2) registerDevice() genera un deviceId nuevo y, si puede, le asigna un instanceIndex:
//        - si el propio cliente lo indica explícitamente (requestedInstanceIndex), se usa ese.
//        - si no, se intenta hacer match con la cola de "lanzamientos pendientes" (ver abajo).
//   3) El cliente guarda deviceId + instanceIndex en su storage local y de ahí en más
//      manda heartbeats normales con ese deviceId.
//
// (instances.js llama expectRegistration(index) explícitamente en el POST /launch,
// además de que este módulo también escucha 'instance:action' por si algo más
// dispara la acción sin pasar por esa ruta)
//
// Cola de lanzamientos pendientes:
//   Cuando instances.js dispara una acción 'launch' sobre un índice (por ej. desde la cadena
//   "Iniciar con monitor"), este módulo lo escucha por el eventBus y guarda {index, ts} en
//   una cola FIFO con TTL. Así, si el próximo /register que llega no trae instanceIndex propio,
//   se le asigna el índice más viejo pendiente (asumiendo que las apps se registran en el
//   mismo orden en que se lanzan las instancias).

const eventBus = require('../utils/eventBus');

const STALE_MS = 45_000; // sin heartbeat en este tiempo -> se considera "no vivo"
const CLEANUP_MS = 5 * 60_000; // barrido periódico de dispositivos muy viejos
const DEVICE_TTL_MS = STALE_MS * 20; // borrado definitivo si no se ve en este tiempo
const PENDING_LAUNCH_TTL_MS = 2 * 60_000; // cuánto dura "pendiente" un launch sin registro asociado

const devices = new Map(); // deviceId -> record
const deviceByIndex = new Map(); // instanceIndex -> deviceId
const pendingLaunches = []; // [{ index, ts }] FIFO

function now() {
  return Date.now();
}

function emptyRecord(deviceId) {
  const ts = now();
  return {
    deviceId,
    instanceIndex: null,
    status: 'unknown',
    event: null,
    appVersion: null,
    ua: null,
    activeApks: [],
    proxies: [],
    apps: {}, // packageName -> { firstSeen, lastSeen, uses }
    meta: {},
    registered: false,
    firstSeen: ts,
    lastSeen: ts,
    registeredAt: null,
    ts,
  };
}

function decorate(record) {
  if (!record) return null;
  return { ...record, alive: now() - record.lastSeen < STALE_MS };
}

// --- Cola de lanzamientos pendientes (alimentada por eventBus) ---------

eventBus.on('instance:action', ({ action, index }) => {
  if (action !== 'launch' || index === null || index === undefined) return;
  pendingLaunches.push({ index: Number(index), ts: now() });
});

function _cleanPendingLaunches() {
  const cutoff = now() - PENDING_LAUNCH_TTL_MS;
  while (pendingLaunches.length > 0 && pendingLaunches[0].ts < cutoff) {
    pendingLaunches.shift();
  }
}

function expectRegistration(index) {
  if (index === null || index === undefined) return;
  pendingLaunches.push({ index: Number(index), ts: now() });
}

function _consumePendingIndex() {
  _cleanPendingLaunches();
  const next = pendingLaunches.shift();
  return next ? next.index : null;
}

// --- Registro (primera conexión) ---------------------------------------

function registerDevice({ appVersion, ua, meta, requestedInstanceIndex } = {}) {
  const deviceId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `dev-${now()}-${Math.random().toString(16).slice(2)}`;

  let instanceIndex = null;
  if (requestedInstanceIndex !== undefined && requestedInstanceIndex !== null && requestedInstanceIndex !== '') {
    const n = Number(requestedInstanceIndex);
    if (Number.isFinite(n)) instanceIndex = n;
  }
  if (instanceIndex === null) {
    instanceIndex = _consumePendingIndex();
  }

  const record = emptyRecord(deviceId);
  record.instanceIndex = instanceIndex;
  record.appVersion = appVersion || null;
  record.ua = ua || null;
  record.meta = meta || {};
  record.registered = true;
  record.registeredAt = now();
  record.status = 'registered';
  record.event = 'register';

  devices.set(deviceId, record);
  if (instanceIndex !== null) deviceByIndex.set(instanceIndex, deviceId);

  eventBus.emit('agent:register', decorate(record));
  return record;
}

// --- Heartbeat -----------------------------------------------------------

function upsertHeartbeat({
  deviceId,
  status,
  ts,
  appVersion,
  event,
  instanceIndex,
  activeApks,
  proxies,
  ua,
  meta,
} = {}) {
  const existing = devices.get(deviceId);
  const record = existing || emptyRecord(deviceId);

  record.status = status || record.status || 'alive';
  record.event = event || record.event;
  record.ts = ts || now();
  record.lastSeen = now();
  if (appVersion) record.appVersion = appVersion;
  if (ua) record.ua = ua;
  if (meta && typeof meta === 'object') record.meta = { ...record.meta, ...meta };
  if (Array.isArray(proxies)) record.proxies = proxies;

  if (Array.isArray(activeApks)) {
    record.activeApks = activeApks;
    for (const pkg of activeApks) {
      if (!pkg) continue;
      const entry = record.apps[pkg] || { firstSeen: now(), uses: 0 };
      entry.lastSeen = now();
      entry.uses += 1;
      record.apps[pkg] = entry;
    }
  }

  // El instanceIndex sólo se pisa si todavía no estaba asignado, o si el
  // cliente lo manda explícito y difiere (por ej. tras un reset manual).
  if (instanceIndex !== undefined && instanceIndex !== null && instanceIndex !== '') {
    const n = Number(instanceIndex);
    if (Number.isFinite(n) && n !== record.instanceIndex) {
      record.instanceIndex = n;
    }
  }
  if (record.instanceIndex !== null) deviceByIndex.set(record.instanceIndex, deviceId);

  devices.set(deviceId, record);
  return decorate(record);
}

// --- Consultas -------------------------------------------------------------

function listDevices() {
  return Array.from(devices.values()).map(decorate);
}

function getDevice(deviceId) {
  return decorate(devices.get(deviceId));
}

function getDeviceByIndex(instanceIndex) {
  const n = Number(instanceIndex);
  const deviceId = deviceByIndex.get(n);
  if (!deviceId) return null;
  return decorate(devices.get(deviceId));
}

function removeDevice(deviceId) {
  const record = devices.get(deviceId);
  if (record && record.instanceIndex !== null) {
    if (deviceByIndex.get(record.instanceIndex) === deviceId) {
      deviceByIndex.delete(record.instanceIndex);
    }
  }
  return devices.delete(deviceId);
}

// --- Limpieza periódica ------------------------------------------------

setInterval(() => {
  const cutoff = now() - DEVICE_TTL_MS;
  for (const [id, record] of devices.entries()) {
    if (record.lastSeen < cutoff) removeDevice(id);
  }
  _cleanPendingLaunches();
}, CLEANUP_MS).unref();

module.exports = {
  STALE_MS,
  registerDevice,
  upsertHeartbeat,
  listDevices,
  getDevice,
  getDeviceByIndex,
  removeDevice,
  expectRegistration,
};