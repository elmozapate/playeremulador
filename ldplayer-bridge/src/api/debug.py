"""
Ruta para prender/apagar el modo verbose y ajustar el TTL del health
cache y el intervalo del monitor en caliente, sin reiniciar el servicio.
Todo lo que se cambia acá queda persistido en disco (ver
core.runtime_state), así que sobrevive a un reinicio del proceso.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.runtime_state import runtime_state

router = APIRouter()


class DebugToggleRequest(BaseModel):
    enable: bool


class HealthTTLRequest(BaseModel):
    seconds: float = Field(..., ge=1)


class MonitorIntervalRequest(BaseModel):
    seconds: float = Field(..., ge=1)


@router.get("/status")
async def get_debug_status():
    return {
        "debug": runtime_state.debug,
        "health_cache_ttl": runtime_state.health_ttl,
        "monitor_interval": runtime_state.monitor_interval,
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
