'use strict';

const express = require('express');
const sseHub = require('../sse/sseHub');
const { upsertHeartbeat, listAgents, getAgent } = require('../services/agentHealth');

function buildAgentRouter() {
  const router = express.Router();

  router.post('/heartbeat', (req, res) => {
    const { deviceId, status, ts, appVersion, event, instanceIndex } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: 'deviceId requerido' });

    const agent = upsertHeartbeat({ deviceId, status, ts, appVersion, event, instanceIndex });

    // --- Log a terminal: útil sobre todo para el evento "boot" (primer aviso al abrir la app)
    const tag = `[agent]`;
    if (event === 'boot') {
      console.log(`${tag} 🟢 BOOT deviceId=${deviceId} instance=${instanceIndex ?? '?'} appVersion=${appVersion ?? '?'} @ ${new Date(agent.lastSeen).toLocaleTimeString()}`);
    } else if (event === 'closing') {
      console.log(`${tag} 🔴 CLOSING deviceId=${deviceId} instance=${instanceIndex ?? '?'}`);
    } else {
      console.log(`${tag} · tick deviceId=${deviceId.slice(0, 8)} instance=${instanceIndex ?? '?'} status=${status}`);
    }

    sseHub.broadcast('agent:heartbeat', agent);

    res.json({ ok: true });
  });

  router.get('/status', (req, res) => {
    res.json(listAgents());
  });

  router.get('/status/:deviceId', (req, res) => {
    const agent = getAgent(req.params.deviceId);
    if (!agent) return res.status(404).json({ error: 'no encontrado' });
    res.json(agent);
  });

  return router;
}

module.exports = buildAgentRouter;