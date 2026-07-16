'use strict';

/**
 * InstanceModel — clase de solo-valores.
 * Es el "documento" único y auditable de cada instancia LDPlayer:
 * combina poder (encendido/apagado), agente (heartbeat de la APK
 * monitor), root, apps, tareas y chequeos de salud.
 *
 * No persiste ni escucha nada por sí misma — eso lo hace
 * instanceModelStore. Esta clase solo representa y valida.
 */

const MAX_TASKS = 50;
const MAX_CHECKS = 30;
const MAX_EVENTS = 50;

class InstanceModel {
  constructor(index) {
    this.index = Number(index);
    this.name = null;

    // --- Poder / ciclo de vida ---
    this.power = {
      status: 'unknown',       // 'on' | 'off' | 'unknown'
      source: null,             // 'status-poller' | 'action' | 'agent'
      updatedAt: null,
      expectedOff: false,       // true si el último apagado fue por un quit nuestro
      lastLaunchAt: null,
      lastQuitAt: null,
      neverSeenOn: true,        // sigue true hasta el primer "on" confirmado
    };

    // --- Agente (APK monitor instalada en el emulador, vía heartbeat) ---
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

    // --- Monitor: vínculo específico con la APK de monitoreo ---
    this.monitor = {
      packageName: null,
      installed: null,          // null = desconocido
      running: false,
      lastOpenedAt: null,
      lastSeenAliveAt: null,
      lastOffCause: null,       // 'expected' | 'crashed' | 'never-started' | null
    };

    // --- Root ---
    this.root = {
      initialRootDone: null,
      ready: null,
      uid: null,
      checkedAt: null,
    };

    // --- Apps instaladas conocidas ---
    this.apps = {}; // packageName -> { installed, lastSeen, uses, running }

    // --- Auditoría ---
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

  /**
   * Valida consistencia interna. Nunca lanza — devuelve issues para
   * que el store decida qué hacer (loguear, marcar la instancia, etc.)
   */
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
      apps: this.apps,
      tasks: this.tasks,
      checks: this.checks,
      events: this.events,
      updatedAt: this.updatedAt,
    };
  }
}

module.exports = { InstanceModel, MAX_TASKS, MAX_CHECKS, MAX_EVENTS };