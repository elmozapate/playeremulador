'use strict';
const express = require('express');
const eventBus = require('../utils/eventBus');
const { LDPlayerApiError } = require('../services/ldplayerClient');
function buildSystemRouter(client, poller) {
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
    poller.refreshNow().catch(() => { });
  };
  const idx = (req) => {
    const n = Number(req.params.index);
    if (!Number.isFinite(n)) {
      const e = new Error(`index inválido: "${req.params.index}"`);
      e.status = 400;
      throw e;
    }
    return n;
  };
  const requireBody = (req, field) => {
    const value = (req.body || {})[field];
    if (value === undefined || value === null || value === '') {
      const e = new Error(`Falta ${field} en el body`);
      e.status = 400;
      throw e;
    }
    return value;
  };

  router.get('/:index/battery', handle((req) => client.getBattery(idx(req))));
  router.post('/:index/battery/level', handle(async (req) => {
    const level = requireBody(req, 'level');
    const result = await client.setBatteryLevel(idx(req), level);
    emitAction('battery:level', idx(req), result);
    return result;
  }));
  router.post('/:index/battery/status', handle(async (req) => {
    const status = requireBody(req, 'status');
    const result = await client.setBatteryStatus(idx(req), status);
    emitAction('battery:status', idx(req), result);
    return result;
  }));
  router.post('/:index/battery/reset', handle(async (req) => {
    const result = await client.resetBattery(idx(req));
    emitAction('battery:reset', idx(req), result);
    return result;
  }));
  router.get('/:index/bluetooth', handle((req) => client.getBluetooth(idx(req))));
  router.post('/:index/bluetooth', handle(async (req) => {
    const enable = requireBody(req, 'enable');
    const result = await client.setBluetooth(idx(req), enable);
    emitAction('bluetooth', idx(req), result);
    return result;
  }));
  router.get('/:index/wifi', handle((req) => client.getWifi(idx(req))));
  router.post('/:index/wifi', handle(async (req) => {
    const enable = requireBody(req, 'enable');
    const result = await client.setWifi(idx(req), enable);
    emitAction('wifi', idx(req), result);
    return result;
  }));
  router.post('/:index/mobile-data', handle(async (req) => {
    const enable = requireBody(req, 'enable');
    const result = await client.setMobileData(idx(req), enable);
    emitAction('mobile-data', idx(req), result);
    return result;
  }));
  router.post('/:index/airplane-mode', handle(async (req) => {
    const enable = requireBody(req, 'enable');
    const result = await client.setAirplaneMode(idx(req), enable);
    emitAction('airplane-mode', idx(req), result);
    return result;
  }));
  router.post('/:index/gps', handle(async (req) => {
    const enable = requireBody(req, 'enable');
    const result = await client.setGps(idx(req), enable);
    emitAction('gps', idx(req), result);
    return result;
  }));
  router.post('/:index/geo', handle(async (req) => {
    const { lat, lon } = req.body || {};
    if (lat === undefined || lon === undefined) {
      const e = new Error('Faltan lat/lon en el body');
      e.status = 400;
      throw e;
    }
    const result = await client.simulateGeo(idx(req), lat, lon);
    emitAction('geo', idx(req), result);
    return result;
  }));
  router.post('/:index/rotation-lock', handle(async (req) => {
    const locked = requireBody(req, 'locked');
    const result = await client.setRotationLock(idx(req), locked);
    emitAction('rotation-lock', idx(req), result);
    return result;
  }));
  router.post('/:index/brightness', handle(async (req) => {
    const level = requireBody(req, 'level');
    const result = await client.setBrightness(idx(req), level);
    emitAction('brightness', idx(req), result);
    return result;
  }));
  router.post('/:index/screen-timeout', handle(async (req) => {
    const ms = requireBody(req, 'ms');
    const result = await client.setScreenTimeout(idx(req), ms);
    emitAction('screen-timeout', idx(req), result);
    return result;
  }));
  router.post('/:index/volume', handle(async (req) => {
    const { stream = 'music', level } = req.body || {};
    if (level === undefined) {
      const e = new Error('Falta level en el body');
      e.status = 400;
      throw e;
    }
    const result = await client.setVolume(idx(req), stream, level);
    emitAction('volume', idx(req), result);
    return result;
  }));
  router.post('/:index/dnd', handle(async (req) => {
    const enable = requireBody(req, 'enable');
    const result = await client.setDnd(idx(req), enable);
    emitAction('dnd', idx(req), result);
    return result;
  }));
  router.post('/:index/screen/on', handle(async (req) => {
    const result = await client.screenOn(idx(req));
    emitAction('screen:on', idx(req), result);
    return result;
  }));
  router.post('/:index/screen/off', handle(async (req) => {
    const result = await client.screenOff(idx(req));
    emitAction('screen:off', idx(req), result);
    return result;
  }));
  router.get('/:index/screen', handle((req) => client.getScreenStatus(idx(req))));
  router.post('/:index/input/key', handle(async (req) => {
    const keycode = requireBody(req, 'keycode');
    return client.pressKey(idx(req), keycode);
  }));
  router.post('/:index/input/text', handle(async (req) => {
    const text = requireBody(req, 'text');
    return client.inputText(idx(req), text);
  }));
  router.post('/:index/input/tap', handle(async (req) => {
    const { x, y } = req.body || {};
    if (x === undefined || y === undefined) {
      const e = new Error('Faltan x/y en el body');
      e.status = 400;
      throw e;
    }
    return client.tap(idx(req), x, y);
  }));
  router.post('/:index/input/swipe', handle(async (req) => {
    const { x1, y1, x2, y2, duration_ms: durationMs } = req.body || {};
    if ([x1, y1, x2, y2].some((v) => v === undefined)) {
      const e = new Error('Faltan x1/y1/x2/y2 en el body');
      e.status = 400;
      throw e;
    }
    return client.swipe(idx(req), x1, y1, x2, y2, durationMs);
  }));
  router.post('/:index/input/long-press', handle(async (req) => {
    const { x, y, duration_ms: durationMs } = req.body || {};
    if (x === undefined || y === undefined) {
      const e = new Error('Faltan x/y en el body');
      e.status = 400;
      throw e;
    }
    return client.longPress(idx(req), x, y, durationMs);
  }));

  // --- Fase 2: escucha de toques reales del dispositivo (percepción, no inyección) ---
  // Nota: estos dos endpoints le piden a Python que arranque/pare de leer `adb getevent`
  // y transmitir por el WS bridge con type "touch-event". Si esa ruta todavía no existe
  // del lado Python, este endpoint devolverá el error tal cual venga de allá (502/404),
  // lo cual sirve como chequeo rápido de "falta implementar en Python".
  router.post('/:index/touch/start', handle(async (req) => {
    const result = await client.startTouchListening(idx(req));
    emitAction('touch:start', idx(req), result);
    return result;
  }));

  router.post('/:index/touch/stop', handle(async (req) => {
    const result = await client.stopTouchListening(idx(req));
    emitAction('touch:stop', idx(req), result);
    return result;
  }));

  // Estado en vivo de una captura activa (no la detiene, no emite acción
  // porque es solo lectura, igual que getBattery/getWifi).
  router.get('/:index/touch/status', handle(async (req) => {
    return await client.getTouchStatus(idx(req));
  }));

  // Cancela y DESCARTA los gestos capturados. Separado de /touch/stop
  // a propósito -- ver nota abajo sobre el WS.
  router.post('/:index/touch/cancel', handle(async (req) => {
    const result = await client.cancelTouchListening(idx(req));
    emitAction('touch:cancel', idx(req), result);
    return result;
  }));

  // Lista global de índices con captura activa. Ruta de 2 segmentos
  // (touch/active) vs. las de arriba que son de 3 (:index/touch/xxx) --
  // no colisionan en Express sin importar el orden de registro.
  router.get('/touch/active', handle(async (req) => {
    return await client.listActiveTouchCaptures();
  }));

  router.post('/:index/apps/uninstall', handle(async (req) => {
    const packageName = requireBody(req, 'package_name');
    const result = await client.uninstallApp(idx(req), packageName);
    emitAction('apps:uninstall', idx(req), result);
    return result;
  }));
  router.post('/:index/apps/force-stop', handle(async (req) => {
    const packageName = requireBody(req, 'package_name');
    const result = await client.forceStopApp(idx(req), packageName);
    emitAction('apps:force-stop', idx(req), result);
    return result;
  }));
  router.post('/:index/apps/clear-data', handle(async (req) => {
    const packageName = requireBody(req, 'package_name');
    const result = await client.clearAppData(idx(req), packageName);
    emitAction('apps:clear-data', idx(req), result);
    return result;
  }));
  router.get('/:index/apps', handle((req) => {
    const onlyThirdParty = req.query.only_third_party !== 'false';
    return client.listApps(idx(req), { onlyThirdParty });
  }));
  router.get('/:index/apps/current', handle((req) => client.getCurrentApp(idx(req))));
  router.post('/:index/apps/permissions/grant', handle(async (req) => {
    const packageName = requireBody(req, 'package_name');
    const permission = requireBody(req, 'permission');
    return client.grantPermission(idx(req), packageName, permission);
  }));
  router.post('/:index/apps/permissions/revoke', handle(async (req) => {
    const packageName = requireBody(req, 'package_name');
    const permission = requireBody(req, 'permission');
    return client.revokePermission(idx(req), packageName, permission);
  }));
  router.post('/:index/apps/play-protect', handle(async (req) => {
    const disable = requireBody(req, 'disable');
    const result = await client.setPlayProtect(idx(req), disable);
    emitAction('apps:play-protect', idx(req), result);
    return result;
  }));
  router.post('/:index/apps/run-reliable', handle(async (req) => {
    const packageName = requireBody(req, 'package_name');
    const { activity, timeout_s: timeoutS } = req.body || {};
    const result = await client.runAppReliable(idx(req), packageName, { activity, timeoutS });
    emitAction('apps:run-reliable', idx(req), result);
    return result;
  }));
  router.get('/:index/root/status', handle((req) => client.getRootStatus(idx(req))));
  router.get('/:index/root/check', handle((req) => client.checkRoot(idx(req))));
  router.get('/:index/root/ensure', handle((req) => client.ensureRoot(idx(req))));
  router.get('/:index/uid', handle((req) => client.getUid(idx(req))));
  router.post('/:index/root/shell', handle(async (req) => {
    const command = requireBody(req, 'command');
    const result = await client.rootShell(idx(req), command);
    emitAction('root:shell', idx(req), result);
    return result;
  }));
  return router;
}
module.exports = buildSystemRouter;