'use strict';
const express = require('express');
const { runSetupPipeline } = require('../services/pipelines/deviceSetupPipeline.js');

function buildPipelineRouter(client) {
  const router = express.Router();

  // POST /api/pipeline/setup  { indices: [0,1,2], options?: {...} }
  // Responde 202 al toque y corre el batch en background.
  // Progreso en vivo por /events: eventos "pipeline:step" y "pipeline:batch".
  router.post('/setup', async (req, res) => {
    const { indices, options } = req.body || {};
    if (!Array.isArray(indices) || indices.length === 0) {
      return res.status(400).json({ error: 'indices requerido (array de números), ej: [0,1,2]' });
    }
    const parsed = indices.map(Number).filter(Number.isFinite);
    if (parsed.length === 0) {
      return res.status(400).json({ error: 'indices inválidos' });
    }
    res.status(202).json({ ok: true, started: true, indices: parsed });
    runSetupPipeline(client, parsed, options || {}).catch((err) => {
      console.error('[pipeline] error fatal en el batch:', err.message);
    });
  });

  return router;
}

module.exports = buildPipelineRouter;