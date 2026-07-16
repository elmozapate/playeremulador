'use strict';

const express = require('express');
const { warmupBeforeJob } = require('../services/pipelines/jobRunner');
function buildServiceRouter(manager, { client } = {}) {
  const router = express.Router();

  router.get('/status', (req, res) => res.json(manager.getStatus()));

  router.get('/logs', (req, res) => {
    const limit = Number(req.query.limit) || 200;
    res.json(manager.getRecentLogs(limit));
  });

  router.post('/start', async (req, res) => {
    try {
      res.json(await manager.start());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/stop', async (req, res) => {
    try {
      res.json(await manager.stop());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/restart', async (req, res) => { try { res.json(await manager.restart()); } catch (err) { res.status(500).json({ error: err.message }); } });
  router.post('/warmup', async (req, res) => {
    if (!client) return res.status(400).json({ error: 'cliente no disponible' });
    const indices = Array.isArray(req.body?.indices) ? req.body.indices.map(Number).filter(Number.isFinite) : [0, 1, 2];
    try {
      await warmupBeforeJob(client, indices);
      res.json({ ok: true, indices });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  return router;
}

module.exports = buildServiceRouter;
