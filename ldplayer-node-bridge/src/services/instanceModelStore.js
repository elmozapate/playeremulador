'use strict';
const eventBus = require('../utils/eventBus');
const { InstanceModel } = require('../models/instanceModel');
const { instanceRecordStore } = require('./instanceRecordStore');
const appsConfigStore = require('./appsConfigStore');
const pythonBridgeSocket = require('./pythonBridgeSocket');
const MONITOR_APP_ID = 'monitor';
class InstanceModelStore {
  constructor() {
    this.models = new Map();
    this._wire();
  }
  _get(index) {
    const n = Number(index);
    if (!Number.isFinite(n)) return null;
    let model = this.models.get(n);
    if (!model) {
      model = new InstanceModel(n);
      model.monitor.packageName = this._monitorPackageName();
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
  _windowService() {
    try { return require('./windowService').getInstance(); } catch (_) { return null; }
  }
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
        const monitorPkg = this._monitorPackageName();
        if (monitorPkg && model.apps[monitorPkg]) {
          model.monitor.installed = !!model.apps[monitorPkg].installed;
        }
      }
      if (record.window && typeof record.window === 'object') {
        model.window = {
          hwnd: record.window.hwnd ?? null,
          pid: record.window.pid ?? null,
          title: record.window.title ?? null,
          state: record.window.state ?? null,
          registeredAt: record.window.registeredAt ?? record.window.registered_at ?? null,
          updatedAt: record.window.updated_at ? record.window.updated_at * 1000 : null,
        };
      }
    } catch (_) {
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
  _wire() {
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
    eventBus.on('python:bridge:instance-event', (payload) => {
      if (!payload || payload.index === undefined) return;
      const model = this._get(payload.index);
      if (!model) return;
      model.pushEvent('python', payload.event || 'evento', { source: 'python-bridge', detail: payload.detail });
      if (payload.event === 'crashed' || payload.event === 'process-exit') {
        this._applyPower(model, 'off', 'python-bridge');
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
    eventBus.on('agent:register', (agentRecord) => this._applyAgent(agentRecord));
    eventBus.on('agent:heartbeat', (agentRecord) => this._applyAgent(agentRecord));
    eventBus.on('window:registered', (payload) => this._applyWindow(payload));
    eventBus.on('window:unregistered', (payload) => this._applyWindow({ ...payload, cleared: true }));
    eventBus.on('window:action', (payload) => this._applyWindowAction(payload));
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
      } else if (action === 'apps:uninstall' && result?.package_name) {
        const pkg = result.package_name;
        model.apps[pkg] = { ...(model.apps[pkg] || {}), installed: false, lastSeen: Date.now() };
        instanceRecordStore.recordApp(index, pkg, { installed: false, last_seen: Date.now() / 1000, source: 'action' }).catch(() => {});
        if (pkg === this._monitorPackageName()) {
          model.monitor.installed = false;
          model.monitor.running = false;
          model.monitor.lastOffCause = 'expected';
        }
        model.pushEvent('apps', `app desinstalada: ${pkg}`);
      }
      this._broadcast(model);
    });
    eventBus.on('pipeline:step', (payload) => this._applyStepAudit(payload));
    eventBus.on('job:step', (payload) =>
      this._applyStepAudit({ index: payload.index, step: payload.step, status: payload.status, data: payload.detail, values: payload.values })
    );
    eventBus.on('job:step', ({ index, step, status, values }) => {
      const monitorPkg = this._monitorPackageName();
      if (!monitorPkg) return;
      const model = this.models.get(Number(index));
      if (!model) return;
      const pkg = values?.package_name;
      if (step === 'run' && status === 'ok' && (!pkg || pkg === monitorPkg)) {
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
    const now = Date.now();
    for (const pkg of model.agent.activeApks) {
      if (!pkg) continue;
      model.apps[pkg] = { ...(model.apps[pkg] || {}), installed: true, lastSeen: now };
      instanceRecordStore.recordApp(index, pkg, { installed: true, last_seen: now / 1000, source: 'agent' }).catch(() => {});
    }
    const monitorPkg = this._monitorPackageName();
    if (monitorPkg) {
      model.monitor.packageName = monitorPkg;
      if (model.apps[monitorPkg]) model.monitor.installed = !!model.apps[monitorPkg].installed;
      if (model.agent.activeApks.includes(monitorPkg)) {
        model.monitor.running = true;
        model.monitor.lastSeenAliveAt = now;
        model.monitor.lastOffCause = null;
      }
    }
    if (agentRecord.event === 'closing') {
      model.monitor.running = false;
    }
    this._validateAndFlag(model);
    this._broadcast(model);
  }
  _applyWindow(payload) {
    const { index } = payload || {};
    if (index === null || index === undefined) return;
    const model = this._get(index);
    if (!model) return;
    if (payload.cleared) {
      model.window = { hwnd: null, pid: null, title: null, state: null, registeredAt: null, updatedAt: Date.now() };
      model.pushEvent('window', `ventana desvinculada${payload.reason ? ` (${payload.reason})` : ''}`);
    } else {
      model.window = {
        hwnd: payload.hwnd,
        pid: payload.pid ?? null,
        title: payload.title ?? null,
        state: payload.state || 'normal',
        registeredAt: Date.now(),
        updatedAt: Date.now(),
      };
      model.pushEvent('window', `ventana vinculada hwnd=${payload.hwnd}`);
    }
    instanceRecordStore.recordWindow(index, model.window).catch(() => {});
    this._broadcast(model);
  }
  _applyWindowAction({ action, hwnd }) {
    const ws = this._windowService();
    if (!ws || hwnd === null || hwnd === undefined) return;
    const entry = ws.getByHwnd(Number(hwnd));
    if (!entry) return;
    const model = this._get(entry.index);
    if (!model) return;
    const stateMap = { minimize: 'minimized', maximize: 'maximized', restore: 'normal', hide: 'hidden', show: 'normal' };
    if (stateMap[action]) {
      model.window = { ...model.window, hwnd: Number(hwnd), state: stateMap[action], updatedAt: Date.now() };
      instanceRecordStore.recordWindow(entry.index, model.window).catch(() => {});
      model.pushEvent('window', `acción de ventana: ${action}`);
      this._broadcast(model);
    }
  }
  _applyStepAudit({ index, step, status, data, values }) {
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
    const pkg = values?.package_name || (data && typeof data === 'object' ? data.package_name : null);
    if ((step === 'install' || String(step).startsWith('install:')) && pkg) {
      const installedOk = status === 'ok';
      model.apps[pkg] = { ...(model.apps[pkg] || {}), installed: installedOk, lastSeen: Date.now() };
      instanceRecordStore.recordApp(index, pkg, { installed: installedOk, last_seen: Date.now() / 1000, source: 'pipeline-step' }).catch(() => {});
      if (pkg === this._monitorPackageName()) model.monitor.installed = installedOk;
    }
    if (step === 'kill' && pkg && status === 'ok' && pkg === this._monitorPackageName()) {
      model.monitor.running = false;
    }
    if (['tool', 'verify', 'note'].includes(step)) {
      model.pushCheck({ step, status, detail: data });
    }
    model.pushEvent('step', `${step} → ${status}`);
  }
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