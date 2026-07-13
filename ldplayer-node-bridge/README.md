# LDPlayer Node Bridge

Sidecar Node.js que se acopla 1:1 a la API `ldplayer-bridge` (FastAPI) y expone
REST + SSE para una interfaz HTML. Opcionalmente también administra el proceso
Python (levantarlo, pararlo, reiniciarlo, ver logs) desde Node.

## Arquitectura

```
src/
  config.js                    # Todo por env vars (ver .env.example)
  index.js                     # Entrypoint: arranca proceso Python (opcional), poller, server
  server.js                    # Arma la app Express
  services/
    ldplayerClient.js           # Cliente HTTP 1:1 con cada endpoint de FastAPI
    pythonServiceManager.js      # spawn/stop/restart de `uvicorn main:app`, logs, auto-restart
    statusPoller.js               # Polling de /status/all, emite eventos para el SSE
  routes/
    instances.js                  # Proxy REST -> ldplayerClient (launch/reboot/quit/quitall/...)
    status.js                      # Proxy REST -> status (sirve desde cache del poller)
    service.js                      # start/stop/restart/logs/status del proceso Python
    events.js                        # Endpoint SSE (/events)
  sse/sseHub.js                       # Broadcast a clientes SSE conectados
  utils/eventBus.js                    # EventEmitter interno que conecta todo
public/index.html                      # Demo mínima: tabla de instancias + acciones + log en vivo
```

## Cómo se acopla al backend Python

Cada método de `ldplayerClient.js` es un espejo exacto de una ruta de
`ldplayer-bridge/src/api/*.py`:

| Node                                  | Python (FastAPI)                          |
|----------------------------------------|---------------------------------------------|
| `client.listInstances()`                | `GET /api/v1/instances`                       |
| `client.quitAllInstances()`             | `POST /api/v1/instances/quitall`              |
| `client.getInstance(i)`                  | `GET /api/v1/instances/{i}`                    |
| `client.launch(i)` / `reboot(i)` / `quit(i)` | `POST /api/v1/instances/{i}/launch` \| `/reboot` \| `/quit` |
| `client.getHealth(i)`                     | `GET /api/v1/instances/{i}/health`              |
| `client.installApp(i, apk)`               | `POST /api/v1/instances/{i}/install`             |
| `client.runApp(i, pkg)`                    | `POST /api/v1/instances/{i}/run`                  |
| `client.modify(i, {cpu,memory,resolution})` | `POST /api/v1/instances/{i}/modify`                |
| `client.getAllStatus()`                      | `GET /api/v1/status/all`                            |
| `client.getInstanceStatus(i)`                | `GET /api/v1/status/{i}`                             |

Si el backend Python devuelve `HTTPException` (`{"detail": "..."}`), `ldplayerClient`
lo traduce a un `LDPlayerApiError` con `.status` y `.detail`, y las rutas Express
lo propagan tal cual a la interfaz HTML.

## Instalación y uso

```bash
npm install
cp .env.example .env
# Editar .env: PYTHON_SRC_DIR debe apuntar a la carpeta src/ del proyecto FastAPI,
# y LDPLAYER_PATH/ADB_PATH si difieren de los default de Windows.
npm start
```

Por default (`PYTHON_MANAGE_PROCESS=true`), Node levanta el `uvicorn` de Python
al arrancar. Si preferís levantarlo vos aparte (systemd, Docker, a mano), poné
`PYTHON_MANAGE_PROCESS=false` y Node solo lo va a consumir por HTTP.

Abrí `http://localhost:4000/public/index.html` (o `http://localhost:4000/` si
serví estático desde la raíz) para ver la demo con tabla de instancias en vivo.

## Endpoints que expone Node a la interfaz HTML

| Método | Ruta                                | Descripción                                    |
|--------|---------------------------------------|--------------------------------------------------|
| GET    | `/health`                              | Estado de Node + Python (ping) + proceso Python  |
| GET    | `/api/instances`                        | Lista instancias                                  |
| POST   | `/api/instances/quitall`                | Cierra todas                                       |
| GET    | `/api/instances/:index`                  | Detalle                                             |
| GET    | `/api/instances/:index/health`            | Batería / estado                                     |
| POST   | `/api/instances/:index/launch`             | Lanza                                                  |
| POST   | `/api/instances/:index/reboot`              | Reinicia                                                |
| POST   | `/api/instances/:index/quit`                 | Cierra                                                   |
| POST   | `/api/instances/:index/install`               | Body: `{"apk_path": "..."}`                                |
| POST   | `/api/instances/:index/run`                    | Body: `{"package_name": "..."}`                             |
| POST   | `/api/instances/:index/modify`                  | Body: `{"cpu","memory","resolution"}`                        |
| GET    | `/api/status/all`                                | Snapshot cacheado por el poller                               |
| GET    | `/api/status/:index`                              | Estado cacheado de una instancia                               |
| GET    | `/api/service/status`                              | Estado del proceso Python administrado                          |
| GET    | `/api/service/logs?limit=200`                       | Últimas líneas de log (stdout+stderr)                            |
| POST   | `/api/service/start` \| `/stop` \| `/restart`        | Control del proceso Python                                        |
| GET    | `/events`                                             | SSE: `python:state`, `python:log`, `python:ready`, `python:exit`, `status:update`, `status:error`, `instance:action` |

## Notas

- El polling hacia Python (`STATUS_POLL_INTERVAL_MS`, default 3000ms) es lo que
  alimenta el SSE — la interfaz HTML nunca pollea directo al backend Python.
- Después de cualquier acción (`launch`, `quit`, `quitall`, etc.) se fuerza un
  refresh inmediato del snapshot (`poller.refreshNow()`) para que la UI no
  espere el próximo tick.
- `pythonServiceManager` reintenta levantar el proceso Python con backoff si
  se cae inesperadamente (`PYTHON_AUTORESTART=true`), hasta `PYTHON_MAX_RESTARTS`.
