'use strict';
const express = require('express');
const sseHub = require('../sse/sseHub');
const deviceRegistry = require('../services/deviceRegistry');
const { consoleLog } = require('../clienteCommonJS');
 let heartbeatInstanceIndex = null;

function buildAgentRouter() {
  const router = express.Router();

  // --- Registro: primera conexión del dispositivo -----------------------
  // El cliente NO manda deviceId acá (todavía no lo tiene). El bridge le
  // asigna uno + (si puede correlacionarlo) el instanceIndex de LDPlayer,
  // y el cliente se queda con eso guardado en su storage local.
  router.post('/register', (req, res) => {
    const { appVersion, ua, meta, instanceIndex } = req.body || {};
    const device = deviceRegistry.registerDevice({
      appVersion,
      ua,
      meta,
      requestedInstanceIndex: instanceIndex,
    });
    consoleLog((
      `[agent] 🆕 REGISTER deviceId=${device.deviceId} instance=${device.instanceIndex ?? '?'} appVersion=${appVersion ?? '?'}`)
    );
    // (el broadcast por SSE ya lo hace deviceRegistry vía eventBus -> sseHub)
    return res.status(201).json({
      ok: true,
      deviceId: device.deviceId,
      instanceIndex: device.instanceIndex,
      serverTime: Date.now(),
    });
  });

  router.post('/heartbeat', (req, res) => {
    const {
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
    } = req.body || {};
    consoleLog((req?.body));

    if (!deviceId) {
      return res.status(400).json({
        error: 'deviceId requerido (registrate primero con POST /api/agent/register)',
      });
    }
    const agent = deviceRegistry.upsertHeartbeat({
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
    });
    const tag = '[agent]';
    if (event === 'boot') {
      consoleLog((
        `${tag} 🟢 BOOT deviceId=${deviceId} instance=${agent.instanceIndex ?? '?'} appVersion=${appVersion ?? '?'} @ ${new Date(agent.lastSeen).toLocaleTimeString()}`)
      );
    } else if (event === 'closing') {
      consoleLog((`${tag} 🔴 CLOSING deviceId=${deviceId} instance=${agent.instanceIndex ?? '?'}`));
    } else {
      consoleLog((
        `${tag} · tick deviceId=${deviceId.slice(0, 8)} instance=${agent.instanceIndex ?? '?'} status=${status}`
      ));
    }
    return res.json({ ok: true });
  });

  router.post('/heartbeat/continue/index', (req, res) => {
    const { instance_index } = req.body || {};
    if (instance_index === undefined || instance_index === null) {
      return res.status(400).json({ error: 'instance_index requerido' });
    }
    const index = Number(instance_index);
    if (!Number.isFinite(index)) {
      return res.status(400).json({ error: 'instance_index inválido' });
    }
    heartbeatInstanceIndex = index;
    consoleLog((`[continue:index] 💾 index autorizado=${heartbeatInstanceIndex}`));
    return res.status(200).json({ ok: true, instance_index: heartbeatInstanceIndex });
  });

  router.post('/heartbeat/continue', (req, res) => {
    const { instance_index } = req.body || {};
    if (instance_index === undefined || instance_index === null) {
      return res.status(400).json({ error: 'instance_index requerido' });
    }
    const requestedIndex = Number(instance_index);
    consoleLog((`[continue] solicitado=${requestedIndex} autorizado=${heartbeatInstanceIndex}`));
    if (requestedIndex !== heartbeatInstanceIndex) {
      consoleLog((`[continue] ⛔ index no coincide requested=${requestedIndex} autorizado=${heartbeatInstanceIndex}`));
      return res.status(200).json({ action: 'wait' });
    }
    consoleLog((`[continue] ✅ index coincide=${requestedIndex}`));
    // FIX: acá se emitía "payload", una variable que no existía en ningún lado
    // (ReferenceError seguro). Mandamos algo con sentido en su lugar.
    sseHub.broadcast('agent:continue', { instance_index: requestedIndex });
    return res.status(200).json({ ok: true, action: 'continue' });
  });

  router.get('/status', (req, res) => {
    return res.json(deviceRegistry.listDevices());
  });

  router.get('/status/:deviceId', (req, res) => {
    const agent = deviceRegistry.getDevice(req.params.deviceId);
    if (!agent) {
      return res.status(404).json({ error: 'no encontrado' });
    }
    return res.json(agent);
  });

  // Alias más explícito para lo mismo que /status, con nombre acorde a lo
  // que realmente devuelve ahora (metadata completa, no sólo status).
  router.get('/devices', (req, res) => {
    return res.json(deviceRegistry.listDevices());
  });

  router.get('/devices/:deviceId', (req, res) => {
    const agent = deviceRegistry.getDevice(req.params.deviceId);
    if (!agent) {
      return res.status(404).json({ error: 'no encontrado' });
    }
    return res.json(agent);
  });

  router.get('/devices/by-index/:index', (req, res) => {
    const agent = deviceRegistry.getDeviceByIndex(req.params.index);
    if (!agent) {
      return res.status(404).json({ error: 'no encontrado' });
    }
    return res.json(agent);
  });

  return router;
}

module.exports = buildAgentRouter;