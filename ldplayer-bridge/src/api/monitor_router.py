"""
monitor_router.py
Endpoints para controlar system_monitor desde afuera (dashboard, curl, etc).

Ubicación sugerida: src/routers/monitor_router.py
Import interno: from services.system_monitor import monitor
  (ajustá el import si tu paquete de servicios se llama distinto)

Integración en tu app principal (src/main.py):

    from routers.monitor_router import router as monitor_router
    app.include_router(monitor_router)

Requiere: pip install psutil
"""

from fastapi import APIRouter

from services.system_monitor import monitor

# prefijo /api/v1 para que quede consistente con el resto de tu API
# (PYTHON_API_BASE_URL=http://127.0.0.1:8000/api/v1)
router = APIRouter(prefix="/api/v1/monitor", tags=["monitor"])


@router.post("/start")
def start_monitor():
    started = monitor.start()
    return {"started": started, **monitor.status()}


@router.post("/stop")
def stop_monitor():
    stopped = monitor.stop()
    return {"stopped": stopped, **monitor.status()}


@router.get("/status")
def get_status():
    return monitor.status()


@router.get("/current")
def get_current():
    return monitor.current() or {"error": "sin datos: monitor inactivo o recién iniciado"}


@router.get("/history")
def get_history():
    return monitor.get_history()


@router.post("/interval/{seconds}")
def set_interval(seconds: float):
    monitor.set_interval(seconds)
    return monitor.status()