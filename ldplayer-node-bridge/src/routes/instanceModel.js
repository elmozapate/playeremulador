'use strict';
const express = require('express');
const instanceModelStore = require('../services/instanceModelStore');
const pythonBridgeSocket = require('../services/pythonBridgeSocket');

function buildInstanceModelRouter() {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(instanceModelStore.list().map((m) => m.toJSON()));
  });
 router.get('/bridge/status', (req, res) => {
   res.json({ connected: pythonBridgeSocket.isConnected(), url: pythonBridgeSocket.url });
 });
  router.get('/:index', (req, res) => {
    const model = instanceModelStore.get(req.params.index);
    if (!model) return res.status(404).json({ error: 'no encontrado' });
    res.json(model.toJSON());
  });

  router.get('/:index/health-decision', (req, res) => {
    const { action, model } = instanceModelStore.decideHealthAction(req.params.index);
    res.json({ action, model: model ? model.toJSON() : null });
  });

  return router;
}
module.exports = buildInstanceModelRouter;