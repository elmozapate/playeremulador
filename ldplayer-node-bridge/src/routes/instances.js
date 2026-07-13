'use strict';

const express = require('express');
const eventBus = require('../utils/eventBus');
const { LDPlayerApiError } = require('../services/ldplayerClient');

/**
 * @param {import('../services/ldplayerClient').LDPlayerClient} client
 * @param {import('../services/statusPoller')} poller
 */
function buildInstancesRouter(client, poller) {
  const router = express.Router();

  const handle = (fn) => async (req, res) => {
    try {
      const data = await fn(req, res);
      res.json(data ?? { success: true });
    } catch (err) {
      if (err instanceof LDPlayerApiError) {
        return res.status(err.status || 502).json({ error: err.message, detail: err.detail });
      }
      res.status(500).json({ error: err.message });
    }
  };

  const emitAction = (action, index, result) => {
    eventBus.emit('instance:action', { action, index, result, ts: Date.now() });
    // Refrescamos el snapshot para que la UI vea el cambio ~inmediatamente
    // en vez de esperar al próximo tick del poller.
    poller.refreshNow().catch(() => { });
  };

  router.get('/', handle(() => client.listInstances()));

  router.post('/quitall', handle(async () => {
    const result = await client.quitAllInstances();
    emitAction('quitall', null, result);
    return result;
  }));

  router.get('/:index', handle((req) => client.getInstance(Number(req.params.index))));

  router.get('/:index/health', handle((req) => client.getHealth(Number(req.params.index))));

  router.post('/:index/launch', handle(async (req) => {
    const result = await client.launch(Number(req.params.index));
    emitAction('launch', Number(req.params.index), result);
    return result;
  }));

  router.post('/:index/reboot', handle(async (req) => {
    const result = await client.reboot(Number(req.params.index));
    emitAction('reboot', Number(req.params.index), result);
    return result;
  }));

  router.post('/:index/clone', handle(async (req) => {
    const { new_name: newName } = req.body || {};
    const result = await client.clone(Number(req.params.index), newName);
    emitAction('clone', Number(req.params.index), result);
    return result;
  }));

  router.post('/:index/quit', handle(async (req) => {
    const result = await client.quit(Number(req.params.index));
    emitAction('quit', Number(req.params.index), result);
    return result;
  }));

  router.post('/:index/install', handle(async (req) => {
    const { apk_path: apkPath } = req.body || {};
    if (!apkPath) {
      const e = new Error('Falta apk_path en el body');
      e.status = 400;
      throw e;
    }
    const result = await client.installApp(Number(req.params.index), apkPath);
    emitAction('install', Number(req.params.index), result);
    return result;
  }));

  router.post('/:index/run', handle(async (req) => {
    const { package_name: packageName } = req.body || {};
    if (!packageName) {
      const e = new Error('Falta package_name en el body');
      e.status = 400;
      throw e;
    }
    const result = await client.runApp(Number(req.params.index), packageName);
    emitAction('run', Number(req.params.index), result);
    return result;
  }));

  router.post('/:index/modify', handle(async (req) => {
    const { cpu, memory, resolution } = req.body || {};
    const result = await client.modify(Number(req.params.index), { cpu, memory, resolution });
    emitAction('modify', Number(req.params.index), result);
    return result;
  }));

  return router;
}

module.exports = buildInstancesRouter;
