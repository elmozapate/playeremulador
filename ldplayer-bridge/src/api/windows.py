"""
Rutas REST para las ventanas host de LDPlayer (control Win32) y el modo
trabajo (todas minimizadas, se maximiza solo la que se usa).
"""
from typing import Any, Dict, List
from fastapi import APIRouter, HTTPException
from core import window_manager as wm
from models.schemas import MoveWindowRequest, WorkModeRequest
from services.window_service import window_service
router = APIRouter()
def _raise_for(e: Exception):
    if isinstance(e, KeyError):
        raise HTTPException(status_code=404, detail=str(e)) from e
    if isinstance(e, wm.WindowManagerError):
        raise HTTPException(status_code=400, detail=str(e)) from e
    raise HTTPException(status_code=500, detail=str(e)) from e
# ---- rutas fijas primero (evita cualquier ambigüedad con /{hwnd}) ----
@router.get("")
async def list_windows() -> List[Dict[str, Any]]:
    return window_service.list_windows()
@router.get("/status")
async def get_status() -> Dict[str, Any]:
    return {
        "work_mode": window_service.work_mode,
        "window_count": len(window_service.list_windows()),
    }
@router.get("/by-instance/{index}")
async def get_window_by_instance(index: int) -> Dict[str, Any]:
    hwnd = window_service.get_hwnd_for_index(index)
    if hwnd is None:
        raise HTTPException(status_code=404, detail=f"No hay ventana registrada para index={index}")
    try:
        return await window_service.get_window_info(hwnd)
    except Exception as e:
        _raise_for(e)
@router.post("/by-instance/{index}/interact")
async def interact_with_instance(index: int) -> Dict[str, Any]:
    """Trae al frente y maximiza la ventana de esta instancia. Si el modo
    trabajo está activo, minimiza de paso todas las demás."""
    try:
        return await window_service.interact(index)
    except Exception as e:
        _raise_for(e)
@router.post("/by-instance/{index}/hard-reset")
async def hard_reset_window(index: int) -> Dict[str, Any]:
    """Mata (forzado) el proceso dueño de la ventana de esta instancia y
    espera a que vuelva a aparecer una ventana nueva para re-vincularla.
    NO toca la instancia Android (a diferencia de reboot/quit+launch),
    solo el proceso host de LDPlayer y su ventana -- pensado para usarse
    como step de pipeline cuando una ventana quedó colgada/zombie."""
    try:
        hwnd = await window_service.hard_reset(index)
        if hwnd is None:
            raise HTTPException(
                status_code=504,
                detail=f"No volvió a aparecer ventana para index={index} tras el hard reset",
            )
        return {"index": index, "hwnd": hwnd, "reset": True}
    except HTTPException:
        raise
    except Exception as e:
        _raise_for(e)
@router.post("/work-mode/enable")
async def enable_work_mode(body: WorkModeRequest):
    return await window_service.enable_work_mode(also_screen_off=body.also_screen_off)
@router.post("/work-mode/disable")
async def disable_work_mode():
    return await window_service.disable_work_mode()
# ---- rutas genéricas por hwnd ----
@router.get("/{hwnd}")
async def get_window(hwnd: int) -> Dict[str, Any]:
    try:
        return await window_service.get_window_info(hwnd)
    except Exception as e:
        _raise_for(e)
@router.post("/{hwnd}/minimize")
async def minimize_window(hwnd: int):
    try:
        await window_service.minimize(hwnd)
        return {"hwnd": hwnd, "state": "minimized"}
    except Exception as e:
        _raise_for(e)
@router.post("/{hwnd}/maximize")
async def maximize_window(hwnd: int):
    try:
        await window_service.maximize(hwnd)
        return {"hwnd": hwnd, "state": "maximized"}
    except Exception as e:
        _raise_for(e)
@router.post("/{hwnd}/restore")
async def restore_window(hwnd: int):
    try:
        await window_service.restore(hwnd)
        return {"hwnd": hwnd, "state": "normal"}
    except Exception as e:
        _raise_for(e)
@router.post("/{hwnd}/hide")
async def hide_window(hwnd: int):
    try:
        await window_service.hide(hwnd)
        return {"hwnd": hwnd, "state": "hidden"}
    except Exception as e:
        _raise_for(e)
@router.post("/{hwnd}/show")
async def show_window(hwnd: int):
    try:
        await window_service.show(hwnd)
        return {"hwnd": hwnd, "visible": True}
    except Exception as e:
        _raise_for(e)
@router.post("/{hwnd}/focus")
async def focus_window(hwnd: int):
    try:
        await window_service.focus(hwnd)
        return {"hwnd": hwnd, "focused": True}
    except Exception as e:
        _raise_for(e)
@router.post("/{hwnd}/move")
async def move_window(hwnd: int, body: MoveWindowRequest):
    try:
        await window_service.move(hwnd, body.x, body.y, body.width, body.height)
        return {"hwnd": hwnd, "rect": {"x": body.x, "y": body.y, "width": body.width, "height": body.height}}
    except Exception as e:
        _raise_for(e)
@router.post("/{hwnd}/close")
async def close_window(hwnd: int):
    """Cierre 'suave' (WM_CLOSE). Puede ser ignorado por la app; para
    forzar usar /kill."""
    try:
        await window_service.close(hwnd)
        return {"hwnd": hwnd, "closed": "requested"}
    except Exception as e:
        _raise_for(e)
@router.post("/{hwnd}/kill")
async def kill_window(hwnd: int):
    """Mata (forzado) el proceso dueño de la ventana."""
    try:
        pid = await window_service.kill(hwnd)
        return {"hwnd": hwnd, "pid": pid, "killed": True}
    except Exception as e:
        _raise_for(e)