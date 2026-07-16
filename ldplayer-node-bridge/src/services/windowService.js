'use strict';
const eventBus = require('../utils/eventBus');

const REGISTER_TIMEOUT_MS = 20000;
const REGISTER_POLL_MS = 500;
const POLL_INTERVAL_MS = 3000;

class WindowService {
  constructor(client) {
    this.client = client;
    this.byHwnd = new Map();   // hwnd → { index, pid, title, state, registeredAt }
    this.byIndex = new Map();  // index → hwnd
    this.workMode = false;
    this._running = false;
    this._timer = null;
  }

  // ---------------------------------------------------------------
  // Ciclo de vida del poller
  // ---------------------------------------------------------------
  start() {
    if (this._running) return;
    this._running = true;
    this._poll(); // primer tick inmediato
    this._timer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
  }

  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _poll() {
    const entries = Array.from(this.byHwnd.entries());
    for (const [hwnd, entry] of entries) {
      try {
        const info = await this.client.getWindow(hwnd);
        if (info.state !== entry.state || info.title !== entry.title) {
          entry.state = info.state;
          entry.title = info.title;
          this._notify('window_state_changed', {
            hwnd,
            instance_index: entry.index,
            state: info.state,
            title: info.title,
          });
        }
      } catch (err) {
        await this._forget(hwnd, true, `ventana cerrada (${err.message})`);
      }
    }
  }

  // ---------------------------------------------------------------
  // Registro hwnd ↔ index
  // ---------------------------------------------------------------
  async registerForInstance(index, timeoutMs = REGISTER_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const win = await this.client.getWindowByInstance(index);
        if (win && win.hwnd) {
          const hwnd = win.hwnd;
          const info = {
            index,
            pid: win.pid || null,
            title: win.title || '',
            state: win.state || '',
            registeredAt: Date.now(),
          };

          // Limpiar registro anterior para este índice
          const oldHwnd = this.byIndex.get(index);
          if (oldHwnd != null) this.byHwnd.delete(oldHwnd);

          this.byHwnd.set(hwnd, info);
          this.byIndex.set(index, hwnd);

          this._notify('window_created', { hwnd, instance_index: index, pid: info.pid });
          eventBus.emit('window:registered', { index, hwnd });
          return hwnd;
        }
      } catch (_) {
        // La ventana aún no existe, seguimos esperando
      }
      await new Promise(resolve => setTimeout(resolve, REGISTER_POLL_MS));
    }
    console.warn(`[window] index=${index}: no apareció ventana tras ${timeoutMs}ms`);
    return null;
  }

  async unregisterForInstance(index) {
    const hwnd = this.byIndex.get(index);
    if (hwnd != null) {
      await this._forget(hwnd, true, 'instancia cerrada');
    }
  }

  async _forget(hwnd, notify = true, reason = '') {
    const entry = this.byHwnd.get(hwnd);
    if (entry) {
      this.byHwnd.delete(hwnd);
      this.byIndex.delete(entry.index);
      if (notify) {
        this._notify('window_closed', {
          hwnd,
          instance_index: entry.index,
          reason,
        });
      }
    }
  }

  // ---------------------------------------------------------------
  // Eventos internos
  // ---------------------------------------------------------------
  _notify(type, payload) {
    eventBus.emit('window:event', { type, ...payload });
  }

  // ---------------------------------------------------------------
  // Consultas
  // ---------------------------------------------------------------
  getHwndForIndex(index) {
    return this.byIndex.get(index);
  }

  getByIndex(index) {
    const hwnd = this.byIndex.get(index);
    if (!hwnd) return null;
    const entry = this.byHwnd.get(hwnd);
    return entry ? { hwnd, ...entry } : null;
  }

  getByHwnd(hwnd) {
    const entry = this.byHwnd.get(hwnd);
    return entry ? { hwnd, ...entry } : null;
  }

  getAll() {
    return Array.from(this.byHwnd.entries()).map(([hwnd, entry]) => ({
      hwnd,
      ...entry,
    }));
  }

  // ---------------------------------------------------------------
  // Acciones sobre una ventana (delegadas al cliente Python)
  // ---------------------------------------------------------------
  async minimize(hwnd)  { await this.client.minimizeWindow(hwnd); }
  async maximize(hwnd)  { await this.client.maximizeWindow(hwnd); }
  async restore(hwnd)   { await this.client.restoreWindow(hwnd); }
  async hide(hwnd)      { await this.client.hideWindow(hwnd); }
  async show(hwnd)      { await this.client.showWindow(hwnd); }
  async focus(hwnd)     { await this.client.focusWindow(hwnd); }
  async move(hwnd, x, y, width, height) {
    await this.client.moveWindow(hwnd, { x, y, width, height });
  }
  async close(hwnd)     { await this.client.closeWindow(hwnd); }
  async kill(hwnd) {
    await this.client.killWindow(hwnd);
    await this._forget(hwnd, true, 'proceso matado manualmente');
  }

  // ---------------------------------------------------------------
  // Modo trabajo
  // ---------------------------------------------------------------
  async enableWorkMode(alsoScreenOff = false) {
    this.workMode = true;
    const hwnds = Array.from(this.byHwnd.keys());
    const results = {};
    for (const hwnd of hwnds) {
      try {
        await this.minimize(hwnd);
        results[hwnd] = 'minimized';
      } catch (err) {
        results[hwnd] = `error: ${err.message}`;
      }
    }
    if (alsoScreenOff) await this._screenOffAll();
    console.log(`[window] modo trabajo ON (${hwnds.length} ventana(s))`);
    return { workMode: true, windows: results };
  }

  async disableWorkMode() {
    this.workMode = false;
    const hwnds = Array.from(this.byHwnd.keys());
    const results = {};
    for (const hwnd of hwnds) {
      try {
        await this.restore(hwnd);
        results[hwnd] = 'restored';
      } catch (err) {
        results[hwnd] = `error: ${err.message}`;
      }
    }
    console.log(`[window] modo trabajo OFF (${hwnds.length} ventana(s))`);
    return { workMode: false, windows: results };
  }

  async interact(index) {
    const hwnd = this.getHwndForIndex(index);
    if (hwnd == null) throw new Error(`No hay ventana registrada para index=${index}`);

    if (this.workMode) {
      const others = Array.from(this.byHwnd.keys()).filter(h => h !== hwnd);
      for (const other of others) {
        try { await this.minimize(other); } catch (_) {}
      }
    }

    await this.restore(hwnd);
    await this.maximize(hwnd);
    await this.focus(hwnd);
    return { index, hwnd, state: 'maximized' };
  }

  async _screenOffAll() {
    const indices = Array.from(this.byIndex.keys());
    for (const idx of indices) {
      try {
        await this.client.rootShell(idx, 'settings put secure lockscreen.disabled 1');
      } catch (_) {}
      try {
        await this.client.screenOff(idx);
      } catch (_) {}
    }
  }

  async screenOnNoLock(index) {
    try {
      await this.client.screenOn(index);
    } catch (_) {}
  }

  // ---------------------------------------------------------------
  // Limpieza
  // ---------------------------------------------------------------
  prune(activeIndices) {
    const activeSet = new Set(activeIndices);
    for (const [idx, hwnd] of this.byIndex.entries()) {
      if (!activeSet.has(idx)) {
        this.byHwnd.delete(hwnd);
        this.byIndex.delete(idx);
      }
    }
  }
}

module.exports = WindowService;