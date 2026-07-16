'use strict';
const express = require('express');
const sseHub = require('../sse/sseHub');
const deviceRegistry = require('../services/deviceRegistry');
const { consoleLog } = require('../clienteCommonJS');

// FIX (Fase 0 #2): antes esto era `let heartbeatInstanceIndex = null;` — una sola instancia
// autorizada a la vez para TODO el sistema. Con dos o más agentes pidiendo "continue" en
// paralelo, el segundo siempre perdía la carrera y quedaba pisado por el primero.
// Ahora es un Map<index, timestampAutorizacion> con expiración, así cada índice tiene su
// propio lock y se puede autorizar a varias instancias en simultáneo.
const CONTINUE_TTL_MS = 30_000;
const authorizedContinues = new Map(); // index -> ts de autorización

setInterval(() => {
  const cutoff = Date.now() - CONTINUE_TTL_MS;
  for (const [index, ts] of authorizedContinues.entries()) {
    if (ts < cutoff) authorizedContinues.delete(index);
  }
}, 10_000).unref();

function buildAgentRouter() {
  const router = express.Router();

  router.post('/register', (req, res) => {
    const { appVersion, ua, meta, instanceIndex } = req.body || {};
    const validIndex = instanceIndex !== undefined && instanceIndex !== null
      ? Number(instanceIndex) : undefined;
    if (instanceIndex !== undefined && instanceIndex !== null && isNaN(validIndex)) {
      return res.status(400).json({ error: 'instanceIndex debe ser un número válido' });
    }
    const device = deviceRegistry.registerDevice({ appVersion, ua, meta, requestedInstanceIndex: validIndex });
    consoleLog(`[agent] 🆕 REGISTER deviceId=${device.deviceId} instance=${device.instanceIndex ?? '?'} appVersion=${appVersion ?? '?'}`);
    return res.status(201).json({ ok: true, deviceId: device.deviceId, instanceIndex: device.instanceIndex, serverTime: Date.now() });
  });

  router.post('/heartbeat', (req, res) => {
    const { deviceId, status, ts, appVersion, event, instanceIndex, activeApks, proxies, ua, meta } = req.body || {};
    consoleLog(req?.body);
    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId requerido (registrate primero con POST /api/agent/register)' });
    }
    let validIndex = null;
    if (instanceIndex !== undefined && instanceIndex !== null) {
      validIndex = Number(instanceIndex);
      if (isNaN(validIndex)) {
        return res.status(400).json({ error: 'instanceIndex debe ser un número válido' });
      }
    }
    const agent = deviceRegistry.upsertHeartbeat({ deviceId, status, ts, appVersion, event, instanceIndex: validIndex, activeApks, proxies, ua, meta });
    const tag = '[agent]';
    if (event === 'boot') {
      consoleLog(`${tag} 🟢 BOOT deviceId=${deviceId} instance=${agent.instanceIndex ?? '?'} appVersion=${appVersion ?? '?'} @ ${new Date(agent.lastSeen).toLocaleTimeString()}`);
    } else if (event === 'closing') {
      consoleLog(`${tag} 🔴 CLOSING deviceId=${deviceId} instance=${agent.instanceIndex ?? '?'}`);
    } else {
      consoleLog(`${tag} · tick deviceId=${deviceId.slice(0, 8)} instance=${agent.instanceIndex ?? '?'} status=${status}`);
    }
    return res.json({ ok: true });
  });

  router.post('/send-url', (req, res) => {
    const { deviceId, instanceIndex, url, timestamp } = req.body || {};
    if (!deviceId && instanceIndex === undefined) {
      return res.status(400).json({ error: 'deviceId o instanceIndex requerido' });
    }
    let device = null;
    if (deviceId) { device = deviceRegistry.getDevice(deviceId); }
    else if (instanceIndex !== undefined) { device = deviceRegistry.getDeviceByIndex(instanceIndex); }
    if (!device) return res.status(404).json({ error: 'dispositivo no encontrado', deviceId, instanceIndex });
    consoleLog(`[send-url] 📤 URL recibida para deviceId=${device.deviceId}: ${url}`);
    sseHub.broadcast('device:url-received', { deviceId: device.deviceId, instanceIndex: device.instanceIndex, url, timestamp });
    return res.json({ ok: true, deviceId: device.deviceId, instanceIndex: device.instanceIndex, url });
  });

  // Autoriza a UN índice puntual a seguir (deja de bloquearlo con "wait").
  router.post('/heartbeat/continue/index', (req, res) => {
    const { instance_index } = req.body || {};
    if (instance_index === undefined || instance_index === null) {
      return res.status(400).json({ error: 'instance_index requerido' });
    }
    const index = Number(instance_index);
    if (!Number.isFinite(index)) {
      return res.status(400).json({ error: 'instance_index inválido' });
    }
    authorizedContinues.set(index, Date.now());
    consoleLog(`[continue:index] 💾 index autorizado=${index} (ttl=${CONTINUE_TTL_MS}ms)`);
    return res.status(200).json({ ok: true, instance_index: index });
  });

  // El agente pregunta si YA puede seguir. Se consume (single-use) al autorizar.
  router.post('/heartbeat/continue', (req, res) => {
    const { instance_index } = req.body || {};
    if (instance_index === undefined || instance_index === null) {
      return res.status(400).json({ error: 'instance_index requerido' });
    }
    const requestedIndex = Number(instance_index);
    const authorizedAt = authorizedContinues.get(requestedIndex);
    const isAuthorized = authorizedAt !== undefined && (Date.now() - authorizedAt) < CONTINUE_TTL_MS;
    consoleLog(`[continue] solicitado=${requestedIndex} autorizado=${isAuthorized}`);
    if (!isAuthorized) {
      return res.status(200).json({ action: 'wait' });
    }
    authorizedContinues.delete(requestedIndex);
    consoleLog(`[continue] ✅ index coincide=${requestedIndex}`);
    sseHub.broadcast('agent:continue', { instance_index: requestedIndex });
    return res.status(200).json({ ok: true, action: 'continue' });
  });

  router.get('/status', (req, res) => res.json(deviceRegistry.listDevices()));
  router.get('/status/:deviceId', (req, res) => {
    const agent = deviceRegistry.getDevice(req.params.deviceId);
    if (!agent) return res.status(404).json({ error: 'no encontrado' });
    return res.json(agent);
  });
  router.get('/devices', (req, res) => res.json(deviceRegistry.listDevices()));
  router.get('/devices/:deviceId', (req, res) => {
    const agent = deviceRegistry.getDevice(req.params.deviceId);
    if (!agent) return res.status(404).json({ error: 'no encontrado' });
    return res.json(agent);
  });
  router.get('/devices/by-index/:index', (req, res) => {
    const agent = deviceRegistry.getDeviceByIndex(req.params.index);
    if (!agent) return res.status(404).json({ error: 'no encontrado' });
    return res.json(agent);
  });
  router.get('/devices/:deviceId/index', (req, res) => {
    const index = deviceRegistry.getIndexForDevice(req.params.deviceId);
    if (index === null) return res.status(404).json({ error: 'dispositivo no encontrado o sin instanceIndex asignado' });
    return res.json({ deviceId: req.params.deviceId, instanceIndex: index });
  });

  return router;
}
module.exports = buildAgentRouter;