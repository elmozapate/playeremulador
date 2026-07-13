# LDPlayer Bridge

API REST (FastAPI) para controlar instancias de LDPlayer vía `ldconsole.exe` y `adb`.

## Arquitectura
src/
config.py # Settings (env vars: LDPLAYER_PATH, ADB_PATH, etc.)
main.py # FastAPI app + lifespan (arranca/para el monitor)
core/ # Wrappers crudos, bloqueantes, sin lógica de negocio
ldplayer.py # -> comandos de ldconsole.exe (launch/quit/reboot/list2/modify/...)
adb.py # -> conexión adb + parseo de dumpsys battery
services/ # Lógica de negocio, todo async
instance_service.py # -> coordina core.ldplayer + core.adb, cache de salud
task_queue.py # -> serializa acciones por índice de instancia
monitor.py # -> polling en background, cache de estado global
models/
schemas.py # Pydantic: ActionResponse, InstanceStatus, ModifyRequest, ...
api/
instances.py # POST /launch /reboot /quit /install /run /modify, GET /health
status.py # GET /status/all, /status/{index} (lee el cache del monitor)

text

Capas: `api` (routers finos) → `services` (async, cache, orquestación) → `core` (subprocess crudo).  
Nada por fuera de `core` llama a `subprocess` directamente.

## Qué se corrigió respecto a la versión original

- **Bug real de concurrencia**: `TaskQueue` hacía `await` sobre el resultado de un `lambda`
  síncrono (`subprocess.run`), lo cual explota en runtime. Ahora detecta si la función es
  coroutine o no, y si es sync la despacha con `asyncio.to_thread`.
- **Código duplicado eliminado**: había dos `LDPlayerController`/`LDConsole` casi idénticos
  (`core/ldplayer.py` viejo, `ldplayer/ldplayer.py`, `ldplayer/console.py`) y dos parsers de
  `list2` con nombres de campo distintos (`handle_bind` vs `bound_handle`). Ahora hay un solo
  `LDConsole` en `core/ldplayer.py`.
- **`api/routes.py` muerto eliminado**: definía su propio `FastAPI()` desconectado del router
  que realmente se montaba en `main.py` — nunca se ejecutaba.
- **Health check duplicado**: `services/health.py` y `ldplayer/adb.py` tenían dos implementaciones
  de battery-health ligeramente distintas. Ahora vive una sola vez en `core/adb.py`.
- **Encapsulamiento**: antes `api/instances.py` tocaba `monitor.cache` directamente al hacer
  `quit`. Ahora usa `monitor.invalidate(index)`.
- **Imports consistentes**: se unificó a imports absolutos (`from core.ldplayer import ...`),
  pensado para correr con `cwd = src/`.
- **`@app.on_event` deprecado** reemplazado por `lifespan` (estilo moderno de FastAPI).
- **`InstanceStatus`** ahora usa los mismos nombres de campo que produce el parser real
  (`bound_handle`, no `handle_bind`).
- **Nuevos endpoints**:
  - `POST /api/v1/instances/quitall` → cierra todas las instancias activas.
  - `POST /api/v1/instances/rebootall` → reinicia todas las instancias activas.
  - Ambos invalidan automáticamente la caché del monitor para evitar datos obsoletos.

## Cómo correr

```bash
pip install -r requirements.txt

# Configurar rutas si difieren de las default (Windows):
export LDPLAYER_PATH="C:\LDPlayer\LDPlayer9\ldconsole.exe"
export ADB_PATH="adb"

cd src
uvicorn main:app --reload --host 0.0.0.0 --port 8000
Docs interactivas en http://localhost:8000/docs.

Endpoints principales
Método	Ruta	Descripción
GET	/api/v1/instances	Lista todas las instancias
GET	/api/v1/instances/{index}	Detalle de una instancia
POST	/api/v1/instances/{index}/launch	Lanza la instancia
POST	/api/v1/instances/{index}/reboot	Reinicia la instancia
POST	/api/v1/instances/{index}/quit	Cierra la instancia
POST	/api/v1/instances/quitall	Cierra todas las instancias
POST	/api/v1/instances/rebootall	Reinicia todas las instancias
GET	/api/v1/instances/{index}/health	Batería / estado (con cache TTL)
POST	/api/v1/instances/{index}/install	Instala un APK ({"apk_path": "..."})
POST	/api/v1/instances/{index}/run	Corre un paquete ({"package_name"})
POST	/api/v1/instances/{index}/modify	Cambia cpu/memory/resolution
GET	/api/v1/status/all	Cache del monitor de background
GET	/api/v1/status/{index}	Estado cacheado de una instancia
Notas sobre quitall y rebootall
Ambos endpoints ejecutan la operación en serie sobre todas las instancias detectadas por list2.

La cola de tareas (task_queue) no se usa para estas operaciones masivas (para no saturar), pero sí se respetan los tiempos de espera entre acciones.

La caché del monitor se invalida completamente después de un quitall o rebootall, forzando una actualización en el próximo ciclo de monitoreo.

Si alguna instancia falla, se registra el error y se continúa con las siguientes (no se interrumpe todo el proceso).

Ejemplos de uso con curl
bash
# Lanzar instancia 0
curl -X POST http://localhost:8000/api/v1/instances/0/launch

# Cerrar todas las instancias
curl -X POST http://localhost:8000/api/v1/instances/quitall

# Reiniciar todas las instancias
curl -X POST http://localhost:8000/api/v1/instances/rebootall

# Ver estado cacheado de todas (rápido)
curl http://localhost:8000/api/v1/status/all
