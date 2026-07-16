'use strict';
const express = require('express');
const eventBus = require('../utils/eventBus');
const { LDPlayerApiError } = require('../services/ldplayerClient');
const windowService = require('../services/windowService');

function buildWindowsRouter(client) {
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
  const emitAction = (action, hwnd, result) => {
    eventBus.emit('window:action', { action, hwnd, result, ts: Date.now() });
  };

  // --- Fase 1/3: registro persistente en memoria, sin ir a ldconsole cada vez ---
  router.get('/registry', (req, res) => res.json(windowService.getAll()));
  router.get('/registry/by-instance/:index', (req, res) => {
    const entry = windowService.getByIndex(req.params.index);
    if (!entry) return res.status(404).json({ error: 'no hay ventana registrada para ese índice' });
    res.json(entry);
  });
  router.get('/registry/:hwnd', (req, res) => {
    const entry = windowService.getByHwnd(req.params.hwnd);
    if (!entry) return res.status(404).json({ error: 'no hay ventana registrada con ese hwnd' });
    res.json(entry);
  });

  router.get('/', handle(() => client.listWindows()));
  router.get('/by-instance/:index', handle((req) => client.getWindowByInstance(Number(req.params.index))));
  router.get('/:hwnd', handle((req) => client.getWindow(Number(req.params.hwnd))));

  router.post('/:hwnd/minimize', handle(async (req) => {
    const result = await client.minimizeWindow(Number(req.params.hwnd));
    emitAction('minimize', Number(req.params.hwnd), result);
    return result;
  }));
  router.post('/:hwnd/maximize', handle(async (req) => {
    const result = await client.maximizeWindow(Number(req.params.hwnd));
    emitAction('maximize', Number(req.params.hwnd), result);
    return result;
  }));
  router.post('/:hwnd/restore', handle(async (req) => {
    const result = await client.restoreWindow(Number(req.params.hwnd));
    emitAction('restore', Number(req.params.hwnd), result);
    return result;
  }));
  router.post('/:hwnd/hide', handle(async (req) => {
    const result = await client.hideWindow(Number(req.params.hwnd));
    emitAction('hide', Number(req.params.hwnd), result);
    return result;
  }));
  router.post('/:hwnd/show', handle(async (req) => {
    const result = await client.showWindow(Number(req.params.hwnd));
    emitAction('show', Number(req.params.hwnd), result);
    return result;
  }));
  router.post('/:hwnd/focus', handle(async (req) => {
    const result = await client.focusWindow(Number(req.params.hwnd));
    emitAction('focus', Number(req.params.hwnd), result);
    return result;
  }));
  router.post('/:hwnd/move', handle(async (req) => {
    const { x, y, width, height } = req.body || {};
    if ([x, y, width, height].some((v) => v === undefined)) {
      const e = new Error('Faltan x/y/width/height en el body');
      e.status = 400;
      throw e;
    }
    const result = await client.moveWindow(Number(req.params.hwnd), { x, y, width, height });
    emitAction('move', Number(req.params.hwnd), result);
    return result;
  }));
  router.post('/:hwnd/close', handle(async (req) => {
    const result = await client.closeWindow(Number(req.params.hwnd));
    emitAction('close', Number(req.params.hwnd), result);
    return result;
  }));
  router.post('/:hwnd/kill', handle(async (req) => {
    const result = await client.killWindow(Number(req.params.hwnd));
    emitAction('kill', Number(req.params.hwnd), result);
    return result;
  }));

  return router;
}
module.exports = buildWindowsRouter;