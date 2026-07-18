'use strict';
const eventBus = require('../utils/eventBus');
const HEARTBEAT_MS = 15000;
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
      'agent:heartbeat',
      'instance-model:update',
      'agent:continue',
      'agent:register',
      'pipeline:step',
      'pipeline:batch',
    ].forEach((event) => {
      eventBus.on(event, forward(event));
    });

    // 'instance-event' (touch-event, touch-discarded, y cualquier otro
    // notify_instance_event(...) futuro de Python) NO tiene un módulo
    // store intermedio como instance-model:update -> instanceModelStore.js.
    // pythonBridgeSocket.js emite esto namespaced como
    // `python:bridge:instance-event` (ver su `eventBus.emit(`python:bridge:${msg.type}`, ...)`),
    // así que hay que escuchar el nombre CON el prefijo y reenviar al
    // browser bajo el nombre pelado, para que el listener del
    // EventSource no tenga que conocer el detalle de implementación
    // del bridge (mismo criterio que ya se usa para instance-model:update).
    eventBus.on('python:bridge:instance-event', (payload) => this.broadcast('instance-event', payload));
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