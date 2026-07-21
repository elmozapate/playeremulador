'use strict';
const express = require('express');
const eventBus = require('../utils/eventBus');
const { LDPlayerApiError } = require('../services/ldplayerClient');
function buildWindowsRouter(client) {
    const windowService = require('../services/windowService').getInstance();
    const router = express.Router();
    const handle = (fn) => async (req, res) => {
        try {
            const data = await fn(req, res);
            res.json(data ?? { success: true });
        } catch (err) {
            if (err instanceof LDPlayerApiError) {
                return res.status(err.status || 502).json({ error: err.message, detail: err.detail });
            }
            res.status(err.status || 500).json({ error: err.message });
        }
    };
    const emitAction = (action, hwnd, result) => {
        eventBus.emit('window:action', { action, hwnd, result, ts: Date.now() });
    };
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
        await windowService._forget(Number(req.params.hwnd), false).catch(() => {});
        emitAction('kill', Number(req.params.hwnd), result);
        return result;
    }));
    router.post('/by-instance/:index/hard-reset', handle(async (req) => {
        const index = Number(req.params.index);
        if (!Number.isFinite(index)) {
            const e = new Error(`index inválido: "${req.params.index}"`);
            e.status = 400;
            throw e;
        }
        const timeoutMs = Number(req.body?.timeoutMs) || undefined;
        const newHwnd = await windowService.hardReset(index, { timeoutMs });
        emitAction('hard-reset', newHwnd, { index });
        return { ok: true, index, hwnd: newHwnd };
    }));
    return router;
}
module.exports = buildWindowsRouter;