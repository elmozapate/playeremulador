'use strict';

const eventBus = require('../utils/eventBus');

const HEARTBEAT_MS = 15000;

/**
 * Mantiene la lista de clientes SSE (pestañas de la interfaz HTML) y
 * reenvía los eventos del eventBus interno como mensajes `event: ... \n data: ...`.
 */
class SseHub {
  constructor() {
    this.clients = new Set();
    this._wireEvents();
    this._heartbeat = setInterval(() => this._pingAll(), HEARTBEAT_MS);
  }

  _wireEvents() {
    const forward = (event) => (payload) => this.broadcast(event, payload);

    [
      'python:state',
      'python:log',
      'python:ready',
      'python:exit',
      'status:update',
      'status:error',
      'instance:action',

      'agent:continue:index',
      'agent:continue'

    ].forEach((event) => {
      eventBus.on(event, forward(event));
    });
  }

  addClient(res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    this.clients.add(res);
  }

  removeClient(res) {
    this.clients.delete(res);
  }

  broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) {
      res.write(payload);
    }
  }

  _pingAll() {
    for (const res of this.clients) {
      res.write(': ping\n\n');
    }
  }

  clientCount() {
    return this.clients.size;
  }
}

module.exports = new SseHub();
