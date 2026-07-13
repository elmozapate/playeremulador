'use strict';

const { spawn } = require('child_process');
const readline = require('readline');
const config = require('../config');
const eventBus = require('../utils/eventBus');
const { LDPlayerClient } = require('./ldplayerClient');

const STATES = Object.freeze({
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  CRASHED: 'crashed',
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Administra el ciclo de vida del proceso Python (uvicorn main:app) desde Node.
 * Equivalente al patrón de sidecar que ya usás en Money4Band: spawn, logs,
 * healthcheck de arranque, y auto-restart ante caídas inesperadas.
 */
class PythonServiceManager {
  constructor(opts = {}) {
    this.opts = { ...config.pythonProcess, ...opts };
    this.state = STATES.STOPPED;
    this.proc = null;
    this.logs = []; // ring buffer { ts, stream, line }
    this._restartAttempts = 0;
    this._manualStop = false;
    this.client = new LDPlayerClient();
  }

  _setState(state) {
    this.state = state;
    eventBus.emit('python:state', { state, pid: this.proc?.pid ?? null });
  }

  _pushLog(stream, line) {
    const entry = { ts: Date.now(), stream, line };
    this.logs.push(entry);
    if (this.logs.length > this.opts.logBufferSize) this.logs.shift();
    eventBus.emit('python:log', entry);
  }

  getRecentLogs(limit = 200) {
    return this.logs.slice(-limit);
  }

  isRunning() {
    return this.state === STATES.RUNNING;
  }

  getStatus() {
    return {
      state: this.state,
      pid: this.proc?.pid ?? null,
      restartAttempts: this._restartAttempts,
      config: {
        pythonBin: this.opts.pythonBin,
        cwd: this.opts.cwd,
        host: this.opts.host,
        port: this.opts.port,
      },
    };
  }

  /**
   * Levanta `uvicorn main:app --host ... --port ...` en this.opts.cwd
   * (la carpeta src/ del proyecto FastAPI) y espera a que responda GET /.
   */
  async start() {
    if (this.state === STATES.RUNNING || this.state === STATES.STARTING) {
      return this.getStatus();
    }
    this._manualStop = false;
    this._setState(STATES.STARTING);

    const args = [
      '-m', 'uvicorn', 'main:app',
      '--host', this.opts.host,
      '--port', String(this.opts.port),
    ];

    const env = { ...process.env };
    for (const [key, value] of Object.entries(this.opts.env)) {
      if (value !== '' && value !== undefined && value !== null) env[key] = String(value);
    }

    this.proc = spawn(this.opts.pythonBin, args, {
      cwd: this.opts.cwd,
      env,
      shell: process.platform === 'win32',
    });

    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => this._pushLog('stdout', line));
    readline.createInterface({ input: this.proc.stderr }).on('line', (line) => this._pushLog('stderr', line));

    this.proc.on('exit', (code, signal) => this._handleExit(code, signal));
    this.proc.on('error', (err) => this._pushLog('stderr', `[spawn error] ${err.message}`));

    const ready = await this._waitUntilReady();
    if (!ready) {
      this._setState(STATES.CRASHED);
      throw new Error(
        `El servicio Python no respondió en ${this.opts.readyTimeoutMs}ms (¿ruta de LDPLAYER_PATH ok? ver logs)`
      );
    }

    this._restartAttempts = 0;
    this._setState(STATES.RUNNING);
    eventBus.emit('python:ready', { pid: this.proc.pid });
    return this.getStatus();
  }

  async _waitUntilReady() {
    const deadline = Date.now() + this.opts.readyTimeoutMs;
    while (Date.now() < deadline) {
      if (await this.client.ping()) return true;
      await sleep(300);
    }
    return false;
  }

  _handleExit(code, signal) {
    eventBus.emit('python:exit', { code, signal });
    this.proc = null;

    if (this._manualStop) {
      this._setState(STATES.STOPPED);
      return;
    }

    this._setState(STATES.CRASHED);
    if (this.opts.autoRestart && this._restartAttempts < this.opts.maxRestartAttempts) {
      this._restartAttempts += 1;
      const backoff = this.opts.restartBackoffMs * this._restartAttempts;
      this._pushLog('stderr', `[manager] proceso caído (code=${code}, signal=${signal}). Reintentando en ${backoff}ms (intento ${this._restartAttempts}/${this.opts.maxRestartAttempts})`);
      setTimeout(() => {
        this.start().catch((err) => this._pushLog('stderr', `[manager] falló el reintento: ${err.message}`));
      }, backoff);
    } else if (!this.opts.autoRestart) {
      this._pushLog('stderr', `[manager] proceso caído (code=${code}, signal=${signal}). autoRestart desactivado.`);
    } else {
      this._pushLog('stderr', '[manager] se alcanzó el máximo de reintentos, no se reinicia más.');
    }
  }

  async stop({ timeoutMs = 5000 } = {}) {
    if (!this.proc) {
      this._setState(STATES.STOPPED);
      return this.getStatus();
    }
    this._manualStop = true;
    this._setState(STATES.STOPPING);

    const proc = this.proc;
    const exited = new Promise((resolve) => proc.once('exit', resolve));

    proc.kill('SIGTERM');
    const timedOut = await Promise.race([
      exited.then(() => false),
      sleep(timeoutMs).then(() => true),
    ]);
    if (timedOut && this.proc) {
      this._pushLog('stderr', '[manager] SIGTERM no bastó, forzando SIGKILL');
      proc.kill('SIGKILL');
      await exited;
    }
    return this.getStatus();
  }

  async restart() {
    await this.stop();
    return this.start();
  }
}

module.exports = { PythonServiceManager, STATES };
