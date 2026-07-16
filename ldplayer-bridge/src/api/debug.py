import time
import platform
import os
import json
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel, Field
from config import settings
from core.runtime_state import runtime_state
from core.data_store import data_store
from services.instance_service import instance_service

router = APIRouter()

async def verify_api_key(x_api_key: str = Header(...)):
    if not settings.API_KEY or x_api_key != settings.API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API Key")
    return x_api_key

# --- Pydantic models ---
class DebugToggleRequest(BaseModel):
    enable: bool

class HealthTTLRequest(BaseModel):
    seconds: float = Field(..., ge=1)

class MonitorIntervalRequest(BaseModel):
    seconds: float = Field(..., ge=1)

class SleepModeRequest(BaseModel):
    enable: bool
    lower_priority: bool = True

# --- Función de locks ARREGLADA (sin self) ---
def clear_orphan_locks(lock_dir: str) -> None:
    """Borra locks cuyo proceso dueño ya no existe."""
    if not os.path.isdir(lock_dir):
        return
    try:
        import psutil
        for name in os.listdir(lock_dir):
            if not name.endswith(".lock"):
                continue
            path = os.path.join(lock_dir, name)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    # Asumimos formato JSON o simple. Usamos split pero con strip por seguridad.
                    pid_str = f.read().strip().split(":")[-1] 
                    pid = int(pid_str)
                    if not psutil.pid_exists(pid):
                        os.remove(path)
            except (ValueError, IndexError, OSError):
                # Si no se puede leer, lo dejamos quieto o lo logueamos
                pass
    except ImportError:
        pass # psutil no disponible

# --- Endpoints con autenticación (opcional, pero recomendada) ---
@router.get("/status", dependencies=[Depends(verify_api_key)])
async def get_debug_status():
    return {
        "debug": runtime_state.debug,
        "health_cache_ttl": runtime_state.health_ttl,
        "monitor_interval": runtime_state.monitor_interval,
        "sleep_mode": runtime_state.sleep_mode,
        "window_work_mode": runtime_state.window_work_mode,
    }

@router.post("/toggle", dependencies=[Depends(verify_api_key)])
async def toggle_debug(body: DebugToggleRequest):
    runtime_state.debug = body.enable
    estado = "activado" if body.enable else "desactivado"
    runtime_state.log_always(f"[DEBUG] modo verbose {estado} vía API")
    return {"debug": runtime_state.debug}

@router.post("/health-ttl", dependencies=[Depends(verify_api_key)])
async def set_health_ttl(body: HealthTTLRequest):
    runtime_state.health_ttl = body.seconds
    return {"health_cache_ttl": runtime_state.health_ttl}

@router.post("/monitor-interval", dependencies=[Depends(verify_api_key)])
async def set_monitor_interval(body: MonitorIntervalRequest):
    runtime_state.monitor_interval = body.seconds
    return {"monitor_interval": runtime_state.monitor_interval}

# --- Endpoint de reposo MEJORADO (detección de SO explícita) ---
@router.post("/sleep", dependencies=[Depends(verify_api_key)])
async def set_sleep_mode(body: SleepModeRequest):
    runtime_state.sleep_mode = body.enable
    
    if body.lower_priority:
        try:
            import psutil
            p = psutil.Process(os.getpid())
            system = platform.system()
            
            if body.enable:
                # Modo reposo (prioridad mínima)
                if system == "Windows":
                    p.nice(psutil.IDLE_PRIORITY_CLASS)  # Windows
                else:
                    p.nice(19)  # Linux / macOS (nice 19 = menor prioridad)
            else:
                # Modo normal
                if system == "Windows":
                    p.nice(psutil.NORMAL_PRIORITY_CLASS)
                else:
                    p.nice(0)
        except Exception as e:
            runtime_state.log_always(f"[sleep] error ajustando prioridad: {e}")
    
    runtime_state.log_always(f"[sleep] modo {'reposo' if body.enable else 'activo'}")
    return {"sleep_mode": runtime_state.sleep_mode}

# --- SNAPSHOT ATOMICO (único archivo) ---
def _perform_snapshot():
    """Lógica interna reutilizable para guardar el estado completo."""
    try:
        instances = instance_service.list_instances()
        snapshot_data = {
            "last_shutdown_at": time.time(),
            "instance_count": len(instances),
            "instances": {str(i["index"]): i for i in instances},
            "runtime_config": {
                "debug": runtime_state.debug,
                "health_cache_ttl": runtime_state.health_ttl,
                "monitor_interval": runtime_state.monitor_interval,
                "sleep_mode": runtime_state.sleep_mode,
            }
        }
        # Guardamos en un SOLO archivo (atomicidad)
        with open(data_store.snapshot_path, "w", encoding="utf-8") as f:
            json.dump(snapshot_data, f, indent=2)
        runtime_state.log_always(f"[snapshot] guardado exitoso ({len(instances)} instancias)")
        return snapshot_data
    except Exception as e:
        runtime_state.log_always(f"[snapshot] ERROR CRÍTICO: {e}")
        # Devolvemos un estado parcial o relanzamos
        raise HTTPException(status_code=500, detail=f"Error guardando snapshot: {str(e)}")

@router.post("/system/shutdown-snapshot", dependencies=[Depends(verify_api_key)])
async def shutdown_snapshot():
    """Guarda el estado completo justo antes de apagar."""
    _perform_snapshot()
    return {"ok": True}

@router.get("/system/last-session", dependencies=[Depends(verify_api_key)])
async def last_session():
    """Devuelve el último estado conocido."""
    try:
        with open(data_store.snapshot_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except FileNotFoundError:
        return {"error": "No hay snapshot previo"}
    except json.JSONDecodeError:
        return {"error": "Snapshot corrupto"}

# --- ¡NUEVO! Snapshot automático al apagar el servicio ---
@router.on_event("shutdown")
async def auto_shutdown_snapshot():
    """Se ejecuta SOLO cuando FastAPI se detiene limpiamente."""
    runtime_state.log_always("[shutdown] Ejecutando snapshot automático...")
    try:
        _perform_snapshot()
    except Exception as e:
        runtime_state.log_always(f"[shutdown] Falló snapshot automático: {e}")