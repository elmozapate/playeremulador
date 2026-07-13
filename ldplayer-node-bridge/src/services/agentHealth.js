'use strict';

/**
 * Store en memoria de heartbeats de los agentes (apps corriendo dentro
 * de cada instancia LDPlayer). No persiste a disco a propósito: si el
 * server Node se reinicia, los agentes vuelven a reportarse solos en
 * segundos (heartbeat cada ~15s desde el cliente).
 */
const STALE_MS = 45_000; // sin heartbeat en 45s -> se considera caído
const CLEANUP_MS = 5 * 60_000; // purga agentes muertos hace rato para no acumular basura

const agents = new Map(); // deviceId -> { deviceId, status, ts, appVersion, lastSeen, event }

function upsertHeartbeat({ deviceId, status, ts, appVersion, event, instanceIndex }) {
  const now = Date.now();
  agents.set(deviceId, {
    deviceId,
    status: status || 'alive',
    event: event || null,
    ts: ts || now,
    appVersion: appVersion || null,
    instanceIndex: instanceIndex ?? null,
    lastSeen: now,
  });
  return agents.get(deviceId);
}

function listAgents() {
  const now = Date.now();
  return Array.from(agents.values()).map((a) => ({
    ...a,
    alive: now - a.lastSeen < STALE_MS,
  }));
}

function getAgent(deviceId) {
  const a = agents.get(deviceId);
  if (!a) return null;
  return { ...a, alive: Date.now() - a.lastSeen < STALE_MS };
}

// Purga periódica de agentes que llevan muertos mucho tiempo (evita fuga
// de memoria si vas rotando UUIDs de emuladores clonados/reinstalados).
setInterval(() => {
  const now = Date.now();
  for (const [id, a] of agents.entries()) {
    if (now - a.lastSeen > STALE_MS * 10) agents.delete(id);
  }
}, CLEANUP_MS).unref();

module.exports = { upsertHeartbeat, listAgents, getAgent, STALE_MS };