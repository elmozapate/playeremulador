'use strict';
const eventBus = require('../utils/eventBus');
const { InstanceModel } = require('../models/instanceModel');
const { instanceRecordStore } = require('./instanceRecordStore');
const appsConfigStore = require('./appsConfigStore');
const pythonBridgeSocket = require('./pythonBridgeSocket');

const MONITOR_APP_ID = 'monitor';

class InstanceModelStore {
  constructor() {
    this.models = new Map(); // index -> InstanceModel
    this._wire();
  }

  _get(index) {
    const n = Number(index);
    if (!Number.isFinite(n)) return null;
    let model = this.models.get(n);
    if (!model) {
      model = new InstanceModel(n);
      this._hydrateFromRecordStore(model);
      this.models.set(n, model);
    }
    return model;
  }

  get(index) {
    return this._get(index);
  }

  list() {
    return Array.from(this.models.keys())
      .sort((a, b) => a - b)
      .map((i) => this.models.get(i));
  }

  _monitorPackageName() {
    const apps = appsConfigStore.readApps();
    const monitor = apps.find((a) => a.id === MONITOR_APP_ID);
    return monitor?.package_name || null;
  }

  /** Trae lo ya persistido por instanceRecordStore (root/apps/tasks/events), sin duplicar el archivo. */
  _hydrateFromRecordStore(model) {
    try {
      const record = instanceRecordStore.get(model.index);
      if (!record) return;
      if (record.name) model.name = record.name;
      if (record.profile && typeof record.profile === 'object' && 'root' in record.profile) {
        model.root.ready = record.profile.root ?? null;
        if (record.profile.updated_at) {
          model.root.checkedAt = record.profile.updated_at * 1000;
        }
      }
      if (Array.isArray(record.tasks)) model.tasks = record.tasks.slice(-25);
      if (Array.isArray(record.events)) {
        model.events = record.events.slice(-25).map((e) => ({
          ts: (e.ts || 0) * 1000 || Date.now(),
          type: e.type,
          message: e.message,
          extra: e.extra || {},
        }));
      }
      if (record.apks && typeof record.apks === 'object') {
        for (const [pkg, info] of Object.entries(record.apks)) {
          model.apps[pkg] = { ...(model.apps[pkg] || {}), ...info };
        }
      }
    } catch (_) {
      // best-effort: si falla la lectura, el modelo en memoria sigue siendo válido
    }
  }

  _validateAndFlag(model) {
    const issues = model.validate();
    for (const issue of issues) {
      model.pushEvent('validation', issue.detail, { code: issue.code, level: issue.level });
    }
    return issues;
  }

  _broadcast(model) {
    eventBus.emit('instance-model:update', model.toJSON());
  }

  // ---------------------------------------------------------------
  // Interceptores de eventos que YA existen en el sistema
  // ---------------------------------------------------------------
  _wire() {
    // 1) Poder real (viene del status poller / API Python)
    eventBus.on('status:update', ({ instances }) => {
      if (!instances || typeof instances !== 'object') return;
      for (const [key, inst] of Object.entries(instances)) {
        const model = this._get(key);
        if (!model) continue;
        const running = inst.android_started === true || inst.status === 'running';
        this._applyPower(model, running ? 'on' : 'off', 'status-poller');
        if (inst.name) model.name = inst.name;
      }
    });
    // 6) Eventos que Python empuja por el WS (más rápido que esperar el próximo poll)
    eventBus.on('python:bridge:instance-event', (payload) => {
      if (!payload || payload.index === undefined) return;
      const model = this._get(payload.index);
      if (!model) return;
      model.pushEvent('python', payload.event || 'evento', { source: 'python-bridge', detail: payload.detail });
      if (payload.event === 'crashed' || payload.event === 'process-exit') {
        this._applyPower(model, 'off', 'python-bridge'); // reutiliza la lógica de expectedOff/crashed
      } else {
        this._broadcast(model);
      }
    });

    eventBus.on('python:bridge:root-status', (payload) => {
      if (!payload || payload.index === undefined) return;
      const model = this._get(payload.index);
      if (!model) return;
      model.root.ready = !!payload.ready;
      if (payload.uid !== undefined) model.root.uid = payload.uid;
      model.root.checkedAt = Date.now();
      this._broadcast(model);
    });
    // 2) Heartbeats del agente (la APK monitor corriendo adentro del emulador)
    eventBus.on('agent:register', (agentRecord) => this._applyAgent(agentRecord));
    eventBus.on('agent:heartbeat', (agentRecord) => this._applyAgent(agentRecord));

    // 3) Acciones que nosotros ejecutamos sobre la instancia (launch/quit/reboot/root)
    eventBus.on('instance:action', ({ action, index, result }) => {
      if (index === null || index === undefined) return;
      const model = this._get(index);
      if (!model) return;
      if (action === 'launch') {
        model.power.lastLaunchAt = Date.now();
        model.power.expectedOff = false;
        model.pushEvent('action', 'launch solicitado');
      } else if (action === 'quit') {
        model.power.lastQuitAt = Date.now();
        model.power.expectedOff = true;
        model.monitor.running = false;
        model.pushEvent('action', 'quit solicitado (apagado esperado)');
      } else if (action === 'reboot') {
        model.pushEvent('action', 'reboot solicitado');
      } else if (action === 'initial-root' && result) {
        model.root.initialRootDone = !!result.success;
        model.root.ready = 'root_active' in result ? !!result.root_active : model.root.ready;
        model.root.checkedAt = Date.now();
        if (result.root_error) {
          model.pushEvent('root', `initial-root: root no quedó activo (${result.root_error})`, { level: 'warn' });
        }
      }
      this._broadcast(model);
    });

    // 4) Pasos de jobs/pipelines → auditoría (tareas, apps, chequeos)
    eventBus.on('pipeline:step', (payload) => this._applyStepAudit(payload));
    eventBus.on('job:step', (payload) =>
      this._applyStepAudit({ index: payload.index, step: payload.step, status: payload.status, data: payload.detail })
    );

    // 5) Marca cuándo se abrió el monitor con éxito (clave para el healthScheduler)
    eventBus.on('job:step', ({ index, step, status }) => {
      const monitorPkg = this._monitorPackageName();
      if (!monitorPkg) return;
      const model = this.models.get(Number(index));
      if (!model) return;
      if (step === 'run' && status === 'ok') {
        model.monitor.packageName = monitorPkg;
        model.monitor.running = true;
        model.monitor.lastOpenedAt = Date.now();
        model.monitor.lastOffCause = null;
        this._broadcast(model);
      }
    });
  }

  _applyPower(model, status, source) {
    const wasOn = model.power.status === 'on';
    model.power.status = status;
    model.power.source = source;
    model.power.updatedAt = Date.now();
    if (status === 'on') model.power.neverSeenOn = false;

    if (wasOn && status === 'off') {
      model.monitor.running = false;
      if (model.power.expectedOff) {
        model.monitor.lastOffCause = 'expected';
      } else {
        model.monitor.lastOffCause = 'crashed';
        model.pushEvent('power', 'la instancia se apagó sin que se pidiera un quit (posible caída)', { level: 'warn' });
      }
    } else if (status === 'off' && model.power.neverSeenOn && !model.power.lastLaunchAt) {
      model.monitor.lastOffCause = 'never-started';
    }

    this._validateAndFlag(model);
    this._broadcast(model);
  }

  _applyAgent(agentRecord) {
    if (!agentRecord) return;
    const index = agentRecord.instanceIndex;
    if (index === null || index === undefined) return;
    const model = this._get(index);
    if (!model) return;

    model.agent.deviceId = agentRecord.deviceId;
    model.agent.alive = !!agentRecord.alive;
    model.agent.status = agentRecord.status;
    model.agent.lastSeen = agentRecord.lastSeen;
    model.agent.appVersion = agentRecord.appVersion;
    model.agent.activeApks = agentRecord.activeApks || [];
    model.agent.proxies = agentRecord.proxies || [];
    model.agent.event = agentRecord.event;

    const monitorPkg = this._monitorPackageName();
    if (monitorPkg && model.agent.activeApks.includes(monitorPkg)) {
      model.monitor.packageName = monitorPkg;
      model.monitor.running = true;
      model.monitor.lastSeenAliveAt = Date.now();
      model.monitor.lastOffCause = null;
    }
    if (agentRecord.event === 'closing') {
      model.monitor.running = false;
    }

    this._validateAndFlag(model);
    this._broadcast(model);
  }

  _applyStepAudit({ index, step, status, data }) {
    if (index === null || index === undefined) return;
    const model = this._get(index);
    if (!model) return;

    if (step && (step === 'wait-adb-ready' || step === 'wait_root_ready')) {
      model.root.ready = status === 'ok';
      model.root.checkedAt = Date.now();
    }
    if (step === 'initial-root' && status === 'ok') {
      model.root.initialRootDone = true;
    }
    if (String(step).startsWith('install:') || step === 'install') {
      const pkg = data?.package_name;
      if (pkg) model.apps[pkg] = { ...(model.apps[pkg] || {}), installed: status === 'ok', lastSeen: Date.now() };
    }
    if (['tool', 'verify', 'note'].includes(step)) {
      model.pushCheck({ step, status, detail: data });
    }
    model.pushEvent('step', `${step} → ${status}`);
  }

  // ---------------------------------------------------------------
  // API de decisión — la usa el healthScheduler
  // ---------------------------------------------------------------

  /**
   * Decide qué hacer con una instancia ANTES de intentar abrir el monitor.
   * Devuelve { action, model } donde action es una de:
   *   'open-monitor'      → está prendida, corresponde abrir la app
   *   'relaunch'          → se apagó sin orden (crash) → hay que reencenderla
   *   'skip-never-started'→ nunca se prendió, no tocar en este ciclo
   *   'skip-expected-off' → apagado intencional (quit), no tocar
   *   'skip-unknown'      → no tenemos ningún dato todavía
   */
  decideHealthAction(index) {
    const model = this._get(index);
    if (!model) return { action: 'skip-unknown', model: null };
    if (model.power.status === 'on') return { action: 'open-monitor', model };
    if (model.power.neverSeenOn && !model.power.lastLaunchAt) return { action: 'skip-never-started', model };
    if (model.power.expectedOff) return { action: 'skip-expected-off', model };
    return { action: 'relaunch', model };
  }
}

module.exports = new InstanceModelStore();