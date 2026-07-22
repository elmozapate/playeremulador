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
  router.get('/excluded', (req, res) => { res.json({ excluded: healthScheduler.getExcluded() }); });
  router.post('/exclude', (req, res) => {
    const { index } = req.body || {};
    if (index === undefined) return res.status(400).json({ error: 'index requerido' });
    res.json({ excluded: healthScheduler.excludeIndex(index) });
  });
  router.post('/include', (req, res) => {
    const { index } = req.body || {};
    if (index === undefined) return res.status(400).json({ error: 'index requerido' });
    res.json({ excluded: healthScheduler.includeIndex(index) });
  });
  router.put('/excluded', (req, res) => {
    const { indices } = req.body || {};
    if (!Array.isArray(indices)) return res.status(400).json({ error: 'indices debe ser array' });
    res.json({ excluded: healthScheduler.setExcluded(indices) });
  });
  return router;
}
module.exports = buildHealthMonitorRouter;