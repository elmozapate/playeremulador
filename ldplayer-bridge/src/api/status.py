from fastapi import APIRouter, HTTPException

from services.monitor import monitor

router = APIRouter()


@router.get("/all")
async def get_all_status():
    """Estado de todas las instancias (desde el cache del monitor de background)."""
    return monitor.get_all_status()


@router.get("/{index}")
async def get_instance_status(index: int):
    """Estado cacheado de una instancia específica."""
    status = monitor.get_status(index)
    if not status:
        raise HTTPException(status_code=404, detail="Instancia no encontrada o sin estado")
    return status
