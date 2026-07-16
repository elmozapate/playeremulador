'use strict';

const express = require('express');
const cors = require('cors');
const config = require('./config.js');
const WindowService = require('./services/windowService');

const { LDPlayerClient } = require('./services/ldplayerClient.js');
const StatusPoller = require('./services/statusPoller.js');

const buildPipelineRouter = require('./routes/pipeline.js');
const buildInstancesRouter = require('./routes/instances.js');
const buildSystemRouter = require('./routes/system.js');
const buildStatusRouter = require('./routes/status.js');
const buildServiceRouter = require('./routes/service.js');
const buildEventsRouter = require('./routes/events.js');
const buildDebugRouter = require('./routes/debug.js');
const buildAppsConfigRouter = require('./routes/appsConfig.js');
const buildInstanceModelRouter = require('./routes/instanceModel.js');
const buildAgentRouter = require('./routes/agent.js');
const buildTasksRouter = require('./routes/tasks.js');
const buildWindowsRouter = require('./routes/windows.js'); // <-- NUEVO (Fase 0)

require('./services/instanceModelStore');
const deviceRegistry = require('./services/deviceRegistry.js');

const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
};

function createServer({ manager } = {}) {
  const client = new LDPlayerClient();
  const poller = new StatusPoller(client);
  const windowService = new WindowService(client);   // ← nuevo

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
  app.use('/api/instance-model', buildInstanceModelRouter());
  app.use('/api/windows', buildWindowsRouter(client)); // <-- NUEVO (Fase 0)

  if (manager) { app.use('/api/service', buildServiceRouter(manager, { client })); }

  app.get('/api/status/combined', async (req, res) => {
    const agents = deviceRegistry.listDevices();
    try {
      const instances = (await client.listInstances?.()) ?? [];
      const arr = Array.isArray(instances) ? instances : instances?.instances || [];
      const withAgents = arr.map((inst) => {
        const index = inst.index ?? inst.Index ?? inst.idx;
        return { ...inst, agent: deviceRegistry.getDeviceByIndex(index) };
      });
      res.json({ instances: withAgents, agents });
    } catch (err) {
      res.status(502).json({
        error: `No se pudo obtener status combinado: ${err.message}`,
        agents,
      });
    }
  });

  app.use(express.static(require('path').resolve(__dirname, '..', 'public')));

  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message || 'Error interno' });
  });

  return { app, client, poller, windowService };
}

module.exports = createServer;