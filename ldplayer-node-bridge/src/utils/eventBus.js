'use strict';

const { EventEmitter } = require('events');

/**
 * Bus de eventos global del sidecar.
 * Todo lo que pasa (logs del proceso Python, cambios de estado de instancias,
 * cambios de estado del propio proceso) se emite acá, y sseHub se suscribe
 * para reenviarlo a la interfaz HTML.
 *
 * Eventos usados en este proyecto:
 *  - 'python:state'   { state, pid }
 *  - 'python:log'      { stream: 'stdout'|'stderr', line, ts }
 *  - 'python:ready'     { pid }
 *  - 'python:exit'       { code, signal }
 *  - 'status:update'      snapshot completo del monitor Python
 *  - 'status:error'        { message }
 *  - 'instance:action'      { action, index, result } (launch/reboot/quit/etc)
 */
class AppEventBus extends EventEmitter {}

module.exports = new AppEventBus();
