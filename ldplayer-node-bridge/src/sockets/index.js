'use strict';
const { Server } = require('socket.io');
const eventBus = require('../utils/eventBus');

function attachSocketIO(httpServer, { path = '/socket.io', corsOrigin = '*' } = {}) {
  const io = new Server(httpServer, {
    path,
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
  });

  const forward = (event) => (payload) => io.emit(event, payload);
  [
    'job:created', 'job:started', 'job:step',
    'job:instance:status', 'job:log', 'job:done', 'job:cancelled',
  ].forEach((event) => eventBus.on(event, forward(event)));

  io.on('connection', (socket) => {
    socket.emit('hello', { ts: Date.now() });
  });

  return io;
}

module.exports = { attachSocketIO };