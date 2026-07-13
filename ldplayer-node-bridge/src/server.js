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
const buildAgentRouter = require('./routes/agent');
const { listAgents } = require('./services/agentHealth');
const corsOptions = {
  origin: '*', // o lista de orígenes permitidos
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true, // si la APK envía cookies o autenticación
};

function createServer({ manager } = {}) {
  const client = new LDPlayerClient();
  const poller = new StatusPoller(client);

  const app = express();

  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));
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
  app.use('/api/agent', buildAgentRouter());
  app.use('/events', buildEventsRouter());
  if (manager) {
    app.use('/api/service', buildServiceRouter(manager));
  }

  app.get('/api/status/combined', async (req, res) => {
    const instances = (await client.listInstances?.()) ?? [];
    const agents = listAgents();
    res.json({ instances, agents });
  });

  app.use(express.static(require('path').resolve(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message || 'Error interno' });
  });

  return { app, client, poller };
}

module.exports = createServer;