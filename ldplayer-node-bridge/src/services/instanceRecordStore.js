'use strict';
/**
 * Registro persistente POR INSTANCIA — espejo Node de
 * services/instance_record_store.py (Python). Mismo archivo
 * (DATA_DIR/instances/<index>.json), mismo protocolo de lock
 * (<archivo>.json.lock, O_CREAT|O_EXCL, stale > 10s se descarta,
 * timeout 5s, retry 30-120ms), para que los dos lados puedan
 * escribir sin pisarse sin necesitar coordinación externa.
 *
 * Responsabilidad de Node: registrar lo que ORQUESTA (pasos/tareas
 * de deviceSetupPipeline.js y jobRunner.js). Health, apks, permisos,
 * launch/reboot/quit y next_check_at los escribe Python — no los
 * tocamos acá para no duplicar/pisar esos campos.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const MAX_EVENTS = 100;
const MAX_TASKS = 100;
const LOCK_TIMEOUT_S = 5.0;
const LOCK_STALE_S = 10.0;
const LOCK_RETRY_MIN_MS = 30;
const LOCK_RETRY_MAX_MS = 120;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

class InstanceRecordStore {
  constructor(baseDir, owner = 'node') {
    this.dir = path.join(baseDir, 'instances');
    this.owner = owner;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  _path(index) { return path.join(this.dir, `${index}.json`); }
  _lockPath(index) { return `${this._path(index)}.lock`; }

  // ------------------------------------------------------------------
  // Lock cross-proceso / cross-lenguaje (mismo protocolo que Python)
  // ------------------------------------------------------------------
  async _acquireLock(index) {
    const lockPath = this._lockPath(index);
    const deadline = Date.now() + LOCK_TIMEOUT_S * 1000;
    for (; ;) {
      try {
        const fd = fs.openSync(lockPath, 'wx'); // O_CREAT|O_EXCL|O_WRONLY, atómico también en Windows
        fs.writeSync(fd, `${this.owner}:${process.pid}:${Date.now() / 1000}`);
        fs.closeSync(fd);
        return;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        let age = null;
        try {
          age = Date.now() - fs.statSync(lockPath).mtimeMs;
        } catch (_) { /* pudo desaparecer justo ahora */ }
        if (age !== null && age > LOCK_STALE_S * 1000) {
          // lock huérfano: el que lo tomó se cayó antes de soltarlo
          try { fs.unlinkSync(lockPath); } catch (_) { }
          continue;
        }
        if (Date.now() > deadline) {
          throw new Error(
            `No se pudo tomar el lock de instances/${index}.json en ${LOCK_TIMEOUT_S}s (¿el otro proceso quedó trabado?)`
          );
        }
        await sleep(randomInt(LOCK_RETRY_MIN_MS, LOCK_RETRY_MAX_MS));
      }
    }
  }

  _releaseLock(index) {
    try { fs.unlinkSync(this._lockPath(index)); } catch (_) { }
  }

  // ------------------------------------------------------------------
  // Lectura / escritura atómica del registro
  // ------------------------------------------------------------------
  _readRaw(index) {
    const filePath = this._path(index);
    if (!fs.existsSync(filePath)) return this._blank(index);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return data && typeof data === 'object' ? data : this._blank(index);
    } catch (_) {
      return this._blank(index);
    }
  }

  _writeRaw(index, data) {
    const filePath = this._path(index);
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(data));
    fs.renameSync(tmpPath, filePath);
  }

  _blank(index) {
    return {
      index,
      name: null,
      window: null,
      updated_at: null,
      updated_by: null,
      health: {},
      schedule: {
        next_check_at: null,
        last_reboot_at: null,
        last_launch_at: null,
        last_quit_at: null,
      },
      apks: {},
      permissions: {},
      tasks: [],
      events: [],
    };
  }

  get(index) { return this._readRaw(index); }

  /** Lock -> leer -> updater(record) muta in-place -> escribir -> unlock. */
  async update(index, updater) {
    await this._acquireLock(index);
    try {
      const record = this._readRaw(index);
      updater(record);
      record.updated_at = Date.now() / 1000;
      record.updated_by = this.owner;
      this._writeRaw(index, record);
      return record;
    } finally {
      this._releaseLock(index);
    }
  }

  delete(index) {
    const filePath = this._path(index);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) { }
    }
  }

  // ------------------------------------------------------------------
  // Helpers de alto nivel (todos con lock) — lado Node: tareas/eventos
  // de orquestación (pipeline / jobs). NO tocar health/apks/permisos/
  // schedule acá: eso es responsabilidad de Python.
  // ------------------------------------------------------------------
  async addEvent(index, eventType, message, extra = null) {
    return this.update(index, (r) => {
      const events = r.events || (r.events = []);
      events.push({
        ts: Date.now() / 1000,
        type: eventType,
        source: this.owner,
        message,
        extra: extra || {},
      });
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    });
  }

  async recordAgent(index, agentInfo) {
    return this.update(index, (r) => {
      r.agent = { ...agentInfo, updated_at: Date.now() / 1000 };
    });
  }
  async addTask(index, taskType, detail = null) {
    const taskId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    await this.update(index, (r) => {
      const tasks = r.tasks || (r.tasks = []);
      tasks.push({
        id: taskId,
        type: taskType,
        status: 'pending',
        created_at: Date.now() / 1000,
        updated_at: Date.now() / 1000,
        detail: detail || {},
      });
      if (tasks.length > MAX_TASKS) tasks.splice(0, tasks.length - MAX_TASKS);
    });
    return taskId;
  }
  async recordWindow(index, windowInfo) {
    return this.update(index, (r) => {
      r.window = { ...windowInfo, updated_at: Date.now() / 1000 };
    });
  }
  async recordApp(index, packageName, info) {
    return this.update(index, (r) => {
      const apks = r.apks || (r.apks = {});
      apks[packageName] = { ...(apks[packageName] || {}), ...info };
    });
  }
  async updateTask(index, taskId, status, detail = null) {
    return this.update(index, (r) => {
      for (const task of r.tasks || []) {
        if (task.id === taskId) {
          task.status = status;
          task.updated_at = Date.now() / 1000;
          if (detail) task.detail = { ...task.detail, ...detail };
          break;
        }
      }
    });
  }

  /** Solo se llama del lado Python (monitor.py), que tiene la lista
   * autoritativa de instancias vía LDConsole. No lo dupliques acá para
   * no generar una carrera de borrado entre los dos procesos. */
  prune(activeIndices) {
    let files;
    try { files = fs.readdirSync(this.dir); } catch (_) { return; }
    for (const name of files) {
      let stem = null;
      if (name.endsWith('.json.lock')) stem = name.slice(0, -'.json.lock'.length);
      else if (name.endsWith('.json')) stem = name.slice(0, -'.json'.length);
      if (stem === null || !/^\d+$/.test(stem)) continue;
      if (!activeIndices.has(Number(stem))) {
        try { fs.unlinkSync(path.join(this.dir, name)); } catch (_) { }
      }
    }
  }
}

const instanceRecordStore = new InstanceRecordStore(config.dataDir, 'node');
module.exports = { InstanceRecordStore, instanceRecordStore };