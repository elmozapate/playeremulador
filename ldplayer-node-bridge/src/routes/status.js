'use strict';

const express = require('express');
const { LDPlayerApiError } = require('../services/ldplayerClient');

/**
 * @param {import('../services/ldplayerClient').LDPlayerClient} client
 * @param {import('../services/statusPoller')} poller
 */
function buildStatusRouter(client, poller) {
  const router = express.Router();

  // Sirve el último snapshot cacheado por el poller de Node (rápido, sin ida
  // y vuelta a Python). Si todavía no hubo ningún tick, cae al backend directo.
  router.get('/all', async (req, res) => {
    const cached = poller.getLastSnapshot();
    if (cached) return res.json(cached.instances);
    try {
      res.json(await client.getAllStatus());
    } catch (err) {
      res.status(err instanceof LDPlayerApiError ? err.status || 502 : 500).json({ error: err.message });
    }
  });

  router.get('/:index', async (req, res) => {
    try {
      res.json(await client.getInstanceStatus(Number(req.params.index)));
    } catch (err) {
      if (err instanceof LDPlayerApiError) {
        return res.status(err.status || 502).json({ error: err.message, detail: err.detail });
      }
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = buildStatusRouter;
