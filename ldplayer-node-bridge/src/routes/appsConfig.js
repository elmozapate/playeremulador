'use strict';
const express = require('express');
const appsConfigStore = require('../services/appsConfigStore');

/**
 * Rutas para leer/editar la lista de apps que usa el pipeline de setup
 * (deviceSetupPipeline.js), persistida en ldplayer-data/config/apps.json.
 *
 *   GET    /api/config/apps        -> lista actual (o los defaults si
 *                                      todavía no se editó nunca)
 *   PUT    /api/config/apps        -> reemplaza la lista completa
 *                                      body: { "apps": [ {id, label,
 *                                      apk_path, package_name}, ... ] }
 *   POST   /api/config/apps        -> agrega o actualiza UNA app (por id)
 *                                      body: { id, label, apk_path,
 *                                      package_name }
 *   DELETE /api/config/apps/:id    -> borra una app por id
 */
function buildAppsConfigRouter() {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({ apps: appsConfigStore.readApps() });
  });

  router.put('/', (req, res) => {
    const { apps } = req.body || {};
    try {
      const saved = appsConfigStore.writeApps(apps);
      res.json({ apps: saved });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/', (req, res) => {
    try {
      const saved = appsConfigStore.upsertApp(req.body || {});
      res.status(201).json({ apps: saved });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      const saved = appsConfigStore.removeApp(req.params.id);
      res.json({ apps: saved });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  return router;
}
module.exports = buildAppsConfigRouter;