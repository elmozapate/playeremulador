'use strict';
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { LDPlayerClient } = require('./services/ldplayerClient');
const StatusPoller = require('./services/statusPoller');
const buildInstancesRouter = require('./routes/instances');
const buildSystemRouter = require('./routes/system');
const buildStatusRouter = require('./routes/status');
const buildServiceRouter = require('./routes/service');
const buildEventsRouter = require('./routes/events');
const buildAgentRouter = require('./routes/agent');
const deviceRegistry = require('./services/deviceRegistry');
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
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
  app.use('/api/instances', buildSystemRouter(client, poller));
  app.use('/api/status', buildStatusRouter(client, poller));
  app.use('/api/agent', buildAgentRouter());
  app.use('/events', buildEventsRouter());
  if (manager) {
    app.use('/api/service', buildServiceRouter(manager));
  }
  app.get('/api/status/combined', async (req, res) => {
    const instances = (await client.listInstances?.()) ?? [];
    const agents = deviceRegistry.listDevices();
    // mismo shape que antes (instances + agents) pero ahora cada instancia
    // ya trae su agente correlacionado si existe (ver withAgent en instances.js
    // -- acá lo repetimos por si esta ruta se llama antes de pasar por ese router).
    const arr = Array.isArray(instances) ? instances : instances?.instances || [];
    const withAgents = arr.map((inst) => {
      const index = inst.index ?? inst.Index ?? inst.idx;
      return { ...inst, agent: deviceRegistry.getDeviceByIndex(index) };
    });
    res.json({ instances: withAgents, agents });
  });
  app.use(express.static(require('path').resolve(__dirname, '..', 'public')));
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message || 'Error interno' });
  });
  return { app, client, poller };
}
module.exports = createServer;