'use strict';

const express = require('express');
const sseHub = require('../sse/sseHub');

function buildEventsRouter() {
  const router = express.Router();

  router.get('/', (req, res) => {
    sseHub.addClient(res);
    req.on('close', () => sseHub.removeClient(res));
  });

  return router;
}

module.exports = buildEventsRouter;
