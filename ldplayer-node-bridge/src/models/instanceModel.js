'use strict';
const MAX_TASKS = 50;
const MAX_CHECKS = 30;
const MAX_EVENTS = 50;
class InstanceModel {
  constructor(index) {
    this.index = Number(index);
    this.name = null;
    this.power = {
      status: 'unknown', source: null, updatedAt: null, expectedOff: false, lastLaunchAt: null, lastQuitAt: null, neverSeenOn: true,
      deprecated: false, deprecatedAt: null, deprecatedReason: null,
    };
    this.agent = {
      deviceId: null,
      alive: false,
      status: null,
      lastSeen: null,
      appVersion: null,
      activeApks: [],
      proxies: [],
      event: null,
    };
    this.monitor = {
      packageName: null,
      installed: null,
      running: false,
      lastOpenedAt: null,
      lastSeenAliveAt: null,
      lastOffCause: null,
    };
    this.root = {
      initialRootDone: null,
      ready: null,
      uid: null,
      checkedAt: null,
    };
    this.window = {
      hwnd: null,
      pid: null,
      title: null,
      state: null, // normal|maximized|minimized|hidden
      registeredAt: null,
      updatedAt: null,
    };
    this.apps = {};
    this.tasks = [];
    this.checks = [];
    this.events = [];
    this.updatedAt = Date.now();
  }
  touch() {
    this.updatedAt = Date.now();
  }
  pushEvent(type, message, extra = {}) {
    this.events.push({ ts: Date.now(), type, message, extra });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.touch();
  }
  pushTask(task) {
    this.tasks.push(task);
    if (this.tasks.length > MAX_TASKS) this.tasks.splice(0, this.tasks.length - MAX_TASKS);
    this.touch();
  }
  pushCheck(check) {
    this.checks.push({ ts: Date.now(), ...check });
    if (this.checks.length > MAX_CHECKS) this.checks.splice(0, this.checks.length - MAX_CHECKS);
    this.touch();
  }
  validate() {
    const issues = [];
    if (this.power.status === 'on' && this.agent.alive === false && this.agent.lastSeen) {
      const staleMs = Date.now() - this.agent.lastSeen;
      if (staleMs > 60_000) {
        issues.push({
          level: 'warn',
          code: 'agent-stale-but-on',
          detail: `agente sin heartbeat hace ${Math.round(staleMs / 1000)}s pero power=on`,
        });
      }
    }
    if (this.power.status === 'off' && this.monitor.running) {
      issues.push({
        level: 'warn',
        code: 'monitor-running-but-off',
        detail: 'monitor marcado como corriendo pero la instancia figura apagada',
      });
    }
    return issues;
  }
  toJSON() {
    return {
      index: this.index,
      name: this.name,
      power: this.power,
      agent: this.agent,
      monitor: this.monitor,
      root: this.root,
      window: this.window,
      apps: this.apps,
      tasks: this.tasks,
      checks: this.checks,
      events: this.events,
      updatedAt: this.updatedAt,
    };
  }
}
module.exports = { InstanceModel, MAX_TASKS, MAX_CHECKS, MAX_EVENTS };