'use strict';
const express = require('express');
const { LDPlayerApiError } = require('../services/ldplayerClient');

/**
 * Passthrough hacia la config runtime de Python: modo verbose, TTL del
 * health cache (archivo en disco) e intervalo del monitor de background.
 * Todo esto se persiste en disco del lado Python, así que sobrevive a
 * reinicios de cualquiera de los dos procesos.
 */
function buildDebugRouter(client) {
  const router = express.Router();
  const handle = (fn) => async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (err) {
      if (err instanceof LDPlayerApiError) {
        return res.status(err.status || 502).json({ error: err.message, detail: err.detail });
      }
      res.status(500).json({ error: err.message });
    }
  };

  router.get('/status', handle(() => client.getDebugStatus()));
  router.get('/last-session', handle(() => client.getLastSession()));

  router.post('/toggle', handle((req) => {
    const { enable } = req.body || {};
    if (typeof enable !== 'boolean') {
      const e = new Error('Falta enable (booleano) en el body');
      e.status = 400;
      throw e;
    }
    return client.toggleDebug(enable);
  }));

  router.post('/health-ttl', handle((req) => {
    const seconds = Number((req.body || {}).seconds);
    if (!Number.isFinite(seconds) || seconds < 1) {
      const e = new Error('Falta seconds (numérico, >= 1) en el body');
      e.status = 400;
      throw e;
    }
    return client.setHealthTtl(seconds);
  }));

  router.post('/monitor-interval', handle((req) => {
    const seconds = Number((req.body || {}).seconds);
    if (!Number.isFinite(seconds) || seconds < 1) {
      const e = new Error('Falta seconds (numérico, >= 1) en el body');
      e.status = 400;
      throw e;
    }
    return client.setMonitorInterval(seconds);
  }));

  return router;
}
module.exports = buildDebugRouter;
