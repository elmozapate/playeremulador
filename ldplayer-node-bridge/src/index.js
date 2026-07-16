'use strict';

const config = require('./config');
const createServer = require('./server');
const { PythonServiceManager } = require('./services/pythonServiceManager');
const { attachSocketIO } = require('./sockets');
const eventBus = require('./utils/eventBus');

async function main() {
  const manager = config.pythonProcess.manage ? new PythonServiceManager() : null;

  const { app, poller } = createServer({ manager });

  // Logueamos en consola de Node lo que va pasando (además de reenviarlo por SSE)
  eventBus.on('python:state', ({ state }) => console.log(`[python] estado -> ${state}`));
  eventBus.on('python:log', ({ stream, line }) => console.log(`[python:${stream}] ${line}`));
  eventBus.on('status:error', ({ message }) => console.warn(`[status-poller] ${message}`));

  if (manager && config.pythonProcess.autoStart) {
    try {
      await manager.start();
      console.log(`[manager] servicio Python levantado (pid=${manager.getStatus().pid})`);
    } catch (err) {
      console.error(`[manager] no se pudo levantar el servicio Python: ${err.message}`);
      console.error('[manager] seguimos igual: podés levantarlo manualmente con POST /api/service/start');
    }
  }

  poller.start();

  const server = app.listen(config.node.port, config.node.host, () => {
    console.log(`[node] bridge escuchando en http://${config.node.host}:${config.node.port}`);
    console.log(`[node] SSE en /events, Socket.IO en /socket.io, API en /api/instances, /api/status, /api/service, /api/tasks`);
  });
  attachSocketIO(server);

  const shutdown = async (signal) => {
    console.log(`\n[node] recibido ${signal}, apagando...`);
    poller.stop();
    server.close();
    if (manager) {
      await manager.stop();
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[node] error fatal en el arranque:', err);
  process.exit(1);
});
