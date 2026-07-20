'use strict';
const express = require('express');
function buildHealthMonitorRouter(healthScheduler) {
  const router = express.Router();
  router.get('/status', (req, res) => {
    res.json(healthScheduler.getStatus());
  });
  router.post('/start', (req, res) => {
    res.json(healthScheduler.start({ force: true }));
  });
  router.post('/stop', (req, res) => {
    res.json(healthScheduler.stop());
  });
  router.post('/interval', (req, res) => {
    const { ms, seconds } = req.body || {};
    const value = ms !== undefined ? Number(ms) : Number(seconds) * 1000;
    try {
      res.json(healthScheduler.setInterval(value));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  router.post('/run-now', async (req, res) => {
    try {
      res.json(await healthScheduler.runNow());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  return router;
}
module.exports = buildHealthMonitorRouter;