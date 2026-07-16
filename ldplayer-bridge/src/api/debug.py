"""
Ruta para prender/apagar el modo verbose, ajustar el TTL del health
cache y el intervalo del monitor en caliente, sin reiniciar el servicio.
Todo lo que se cambia acá queda persistido en disco (ver
core.runtime_state), así que sobrevive a un reinicio del proceso.

Nuevo: modo reposo (bajo consumo), snapshot final al apagar y
recuperación de última sesión al iniciar.
"""
import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from core.runtime_state import runtime_state
from core.data_store import data_store
from services.instance_service import instance_service

router = APIRouter()

class DebugToggleRequest(BaseModel):
    enable: bool

class HealthTTLRequest(BaseModel):
    seconds: float = Field(..., ge=1)

class MonitorIntervalRequest(BaseModel):
    seconds: float = Field(..., ge=1)

# ---------- NUEVO: modo reposo ----------
class SleepModeRequest(BaseModel):
    enable: bool
    lower_priority: bool = True
# ----------------------------------------
def clear_orphan_locks(self) -> None:
        """Borra locks cuyo proceso dueño ya no existe. Llamar una sola vez
        al arrancar el servicio, antes de que empiece a llegar tráfico."""
        try:
            files = os.listdir(self.dir)
        except OSError:
            return
        import psutil  # ya es dependencia opcional del proyecto (core/adb.py)
        for name in files:
            if not name.endswith(".lock"):
                continue
            path = os.path.join(self.dir, name)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()
                pid = int(content.split(":")[1])
                if not psutil.pid_exists(pid):
                    os.remove(path)
            except Exception:
                # si no se puede parsear o psutil no está, no tocar nada
                pass

@router.get("/status")
async def get_debug_status():
    return {
        "debug": runtime_state.debug,
        "health_cache_ttl": runtime_state.health_ttl,
        "monitor_interval": runtime_state.monitor_interval,
        "sleep_mode": runtime_state.sleep_mode,   # exponemos el estado
    }

@router.post("/toggle")
async def toggle_debug(body: DebugToggleRequest):
    runtime_state.debug = body.enable
    estado = "activado" if body.enable else "desactivado"
    runtime_state.log_always(f"[DEBUG] modo verbose {estado} vía API")
    return {"debug": runtime_state.debug}

@router.post("/health-ttl")
async def set_health_ttl(body: HealthTTLRequest):
    if body.seconds < 1:
        raise HTTPException(status_code=400, detail="El TTL debe ser >= 1 segundo")
    runtime_state.health_ttl = body.seconds
    runtime_state.log_always(f"[DEBUG] health cache TTL actualizado a {body.seconds}s vía API")
    return {"health_cache_ttl": runtime_state.health_ttl}

@router.post("/monitor-interval")
async def set_monitor_interval(body: MonitorIntervalRequest):
    if body.seconds < 1:
        raise HTTPException(status_code=400, detail="El intervalo debe ser >= 1 segundo")
    runtime_state.monitor_interval = body.seconds
    runtime_state.log_always(f"[DEBUG] intervalo del monitor actualizado a {body.seconds}s vía API")
    return {"monitor_interval": runtime_state.monitor_interval}

# ---------- NUEVO: endpoint de reposo ----------
@router.post("/sleep")
async def set_sleep_mode(body: SleepModeRequest):
    runtime_state.sleep_mode = body.enable
    if body.lower_priority:
        try:
            import psutil, os
            p = psutil.Process(os.getpid())
            if body.enable:
                # Windows: IDLE_PRIORITY_CLASS ; Linux: nice alto
                p.nice(psutil.IDLE_PRIORITY_CLASS if hasattr(psutil, "IDLE_PRIORITY_CLASS") else 19)
            else:
                p.nice(psutil.NORMAL_PRIORITY_CLASS if hasattr(psutil, "NORMAL_PRIORITY_CLASS") else 0)
        except Exception as e:
            runtime_state.log_always(f"[sleep] no se pudo ajustar prioridad: {e}")
    estado = "reposo" if body.enable else "activo"
    runtime_state.log_always(f"[sleep] modo {estado}")
    return {"sleep_mode": runtime_state.sleep_mode}
# -----------------------------------------------

# ---------- NUEVO: snapshot final y última sesión ----------
@router.post("/system/shutdown-snapshot")
async def shutdown_snapshot():
    """Guarda el estado completo de las instancias justo antes de apagar."""
    instances = await instance_service.list_instances()
    data_store.write_status_snapshot({
        str(i["index"]): i for i in instances
    })
    data_store.write_runtime_config({
        "debug": runtime_state.debug,
        "health_cache_ttl": runtime_state.health_ttl,
        "monitor_interval": runtime_state.monitor_interval,
        "sleep_mode": runtime_state.sleep_mode,
        "last_shutdown_at": time.time(),
        "last_shutdown_instance_count": len(instances),
    })
    runtime_state.log_always(f"[shutdown] snapshot final guardado ({len(instances)} instancias)")
    return {"ok": True, "instances": len(instances)}

@router.get("/system/last-session")
async def last_session():
    """Devuelve el último estado conocido antes del apagado anterior."""
    cfg = data_store.read_runtime_config() or {}
    snapshot = data_store.read_status_snapshot() or {}
    return {
        "last_shutdown_at": cfg.get("last_shutdown_at"),
        "instances": snapshot.get("instances", {}),
        "updated_at": snapshot.get("updated_at"),
    }
# -----------------------------------------------------------