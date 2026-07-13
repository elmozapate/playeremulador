'use strict';

const express = require('express');
const sseHub = require('../sse/sseHub');
const {
  upsertHeartbeat,
  listAgents,
  getAgent
} = require('../services/agentHealth');

// Index autorizado para continuar
let heartbeatInstanceIndex = null;

function buildAgentRouter() {
  const router = express.Router();

  router.post('/heartbeat', (req, res) => {
    const {
      deviceId,
      status,
      ts,
      appVersion,
      event,
      instanceIndex
    } = req.body || {};

    if (!deviceId) {
      return res.status(400).json({
        error: 'deviceId requerido'
      });
    }

    console.log(instanceIndex, deviceId);

    const agent = upsertHeartbeat({
      deviceId,
      status,
      ts,
      appVersion,
      event,
      instanceIndex
    });

    const tag = '[agent]';

    if (event === 'boot') {
      console.log(
        `${tag} 🟢 BOOT deviceId=${deviceId} instance=${instanceIndex ?? '?'} appVersion=${appVersion ?? '?'} @ ${new Date(agent.lastSeen).toLocaleTimeString()}`
      );
    } else if (event === 'closing') {
      console.log(
        `${tag} 🔴 CLOSING deviceId=${deviceId} instance=${instanceIndex ?? '?'}`
      );
    } else {
      console.log(
        `${tag} · tick deviceId=${deviceId.slice(0, 8)} instance=${instanceIndex ?? '?'} status=${status}`
      );
    }

    sseHub.broadcast('agent:heartbeat', agent);

    return res.json({
      ok: true
    });
  });

  // ============================================================
  // DEFINE EL INDEX QUE TIENE PERMISO PARA CONTINUAR
  // ============================================================

  router.post('/heartbeat/continue/index', (req, res) => {
    const { instance_index } = req.body || {};

    if (instance_index === undefined || instance_index === null) {
      return res.status(400).json({
        error: 'instance_index requerido'
      });
    }

    const index = Number(instance_index);

    if (!Number.isFinite(index)) {
      return res.status(400).json({
        error: 'instance_index inválido'
      });
    }

    heartbeatInstanceIndex = index;

    console.log(
      `[continue:index] 💾 index autorizado=${heartbeatInstanceIndex}`
    );/* 
    sseHub.broadcast(
      'agent:continue:index',
      payload
    ); */
    return res.status(200).json({
      ok: true,
      instance_index: heartbeatInstanceIndex
    });
  });

  // ============================================================
  // CONSULTA SI PUEDE CONTINUAR
  // ============================================================

  router.post('/heartbeat/continue', (req, res) => {
    const { instance_index } = req.body || {};

    if (instance_index === undefined || instance_index === null) {
      return res.status(400).json({
        error: 'instance_index requerido'
      });
    }

    const requestedIndex = Number(instance_index);

    console.log(
      `[continue] solicitado=${requestedIndex} autorizado=${heartbeatInstanceIndex}`
    );

    if (requestedIndex !== heartbeatInstanceIndex) {
      console.log(
        `[continue] ⛔ index no coincide requested=${requestedIndex} autorizado=${heartbeatInstanceIndex}`
      );

      return res.status(200).json({
        action: 'wait'
      });
    }

    console.log(
      `[continue] ✅ index coincide=${requestedIndex}`
    );
    sseHub.broadcast(
      'agent:continue',
      payload
    );
    return res.status(200).json({
       ok: true,
 action: 'continue'
    });
  });

  router.get('/status', (req, res) => {
    return res.json(listAgents());
  });

  router.get('/status/:deviceId', (req, res) => {
    const agent = getAgent(req.params.deviceId);

    if (!agent) {
      return res.status(404).json({
        error: 'no encontrado'
      });
    }

    return res.json(agent);
  });

  return router;
}

module.exports = buildAgentRouter;