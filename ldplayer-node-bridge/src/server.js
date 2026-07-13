'use strict';

const express = require('express');
const cors = require('cors');
const config = require('./config');
const { LDPlayerClient } = require('./services/ldplayerClient');
const StatusPoller = require('./services/statusPoller');
const buildInstancesRouter = require('./routes/instances');
const buildStatusRouter = require('./routes/status');
const buildServiceRouter = require('./routes/service');
const buildEventsRouter = require('./routes/events');

/**
 * Arma la app Express. No la levanta (eso lo hace index.js) para poder
 * testearla o embeberla en otro proceso si hace falta.
 */
function createServer({ manager } = {}) {
  const client = new LDPlayerClient();
  const poller = new StatusPoller(client);

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', async (req, res) => {
    res.json({
      node: 'ok',
      python: (await client.ping()) ? 'ok' : 'unreachable',
      pythonProcess: manager ? manager.getStatus() : { managed: false },
    });
  });

  app.use('/api/instances', buildInstancesRouter(client, poller));
  app.use('/api/status', buildStatusRouter(client, poller));
  app.use('/events', buildEventsRouter());
  if (manager) {
    app.use('/api/service', buildServiceRouter(manager));
  }

  app.use(express.static(require('path').resolve(__dirname, '..', 'public')));

  // Handler de errores por si algo se escapa de los try/catch de las rutas
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message || 'Error interno' });
  });

  return { app, client, poller };
}

module.exports = createServer;
