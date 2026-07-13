'use strict';

const express = require('express');

/**
 * @param {import('../services/pythonServiceManager').PythonServiceManager} manager
 */
function buildServiceRouter(manager) {
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

  router.post('/restart', async (req, res) => {
    try {
      res.json(await manager.restart());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = buildServiceRouter;
