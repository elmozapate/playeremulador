'use strict';
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { LDPlayerClient } = require('./services/ldplayerClient');
const StatusPoller = require('./services/statusPoller');
const buildPipelineRouter = require('./routes/pipeline.js');
const buildInstancesRouter = require('./routes/instances');
const buildSystemRouter = require('./routes/system');
const buildStatusRouter = require('./routes/status');
const buildServiceRouter = require('./routes/service');
const buildEventsRouter = require('./routes/events');
const buildDebugRouter = require('./routes/debug');
const buildAppsConfigRouter = require('./routes/appsConfig');
const buildAgentRouter = require('./routes/agent');
const buildTasksRouter = require('./routes/tasks');
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
  app.use('/api/debug', buildDebugRouter(client));
  app.use('/api/config/apps', buildAppsConfigRouter());
  app.use('/api/agent', buildAgentRouter());
  app.use('/events', buildEventsRouter());
  app.use('/api/pipeline', buildPipelineRouter(client));
  app.use('/api/tasks', buildTasksRouter(client));
  if (manager) {
    app.use('/api/service', buildServiceRouter(manager));
  }
  app.get('/api/status/combined', async (req, res) => {
    const instances = (await client.listInstances?.()) ?? [];
    const agents = deviceRegistry.listDevices();
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