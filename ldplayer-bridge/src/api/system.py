from typing import List
from models import RootShellRequest
import asyncio

from fastapi import APIRouter, HTTPException
from services.touch_service import touch_service, TouchServiceError
from core.ldplayer import LDConsoleError
from models.schemas import (
    WarmupRequest,
    ActionResponse,
    BatteryLevelRequest,
    BatteryStatusRequest,
    BrightnessRequest,
    GeoRequest,
    KeyRequest,
    LongPressRequest,
    PackageRequest,
    PermissionRequest,
    PlayProtectRequest,
    RotationLockRequest,
    RunAppReliableRequest,
    ScreenTimeoutRequest,
    SwipeRequest,
    TapRequest,
    TextRequest,
    ToggleRequest,
    VolumeRequest,
)
from services.instance_service import InstanceNotFoundError, instance_service
from services.task_queue import task_queue

router = APIRouter()


def _raise_for(e: Exception):
    if isinstance(e, InstanceNotFoundError):
        raise HTTPException(status_code=404, detail=str(e)) from e
    if isinstance(e, TimeoutError):
        raise HTTPException(status_code=504, detail=str(e)) from e
    if isinstance(e, (LDConsoleError, ValueError)):
        raise HTTPException(status_code=400, detail=str(e)) from e
    raise HTTPException(status_code=500, detail=str(e)) from e


# ======================================================================
# Batería
# ======================================================================
@router.get("/{index}/battery")
async def get_battery(index: int):
    try:
        health = await instance_service.get_health(index, use_cache=False)
        return health.get("battery") or {}
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/battery/level", response_model=ActionResponse)
async def set_battery_level(index: int, body: BatteryLevelRequest):
    try:
        await task_queue.enqueue(index, instance_service.set_battery_level, index, body.level)
        return ActionResponse(success=True, message=f"Batería fijada en {body.level}%", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/battery/status", response_model=ActionResponse)
async def set_battery_status(index: int, body: BatteryStatusRequest):
    try:
        await task_queue.enqueue(index, instance_service.set_battery_status, index, body.status)
        return ActionResponse(success=True, message=f"Estado de batería: {body.status}", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/battery/reset", response_model=ActionResponse)
async def reset_battery(index: int):
    try:
        await task_queue.enqueue(index, instance_service.reset_battery, index)
        return ActionResponse(success=True, message="Batería restaurada", index=index)
    except Exception as e:
        _raise_for(e)


# ======================================================================
# Radios
# ======================================================================
@router.post("/{index}/bluetooth", response_model=ActionResponse)
async def set_bluetooth(index: int, body: ToggleRequest):
    try:
        await task_queue.enqueue(index, instance_service.set_bluetooth, index, body.enable)
        estado = "activado" if body.enable else "desactivado"
        return ActionResponse(success=True, message=f"Bluetooth {estado}", index=index)
    except Exception as e:
        _raise_for(e)


@router.get("/{index}/bluetooth")
async def get_bluetooth(index: int):
    try:
        return {"enabled": await instance_service.get_bluetooth_status(index)}
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/wifi", response_model=ActionResponse)
async def set_wifi(index: int, body: ToggleRequest):
    try:
        await task_queue.enqueue(index, instance_service.set_wifi, index, body.enable)
        estado = "activado" if body.enable else "desactivado"
        return ActionResponse(success=True, message=f"WiFi {estado}", index=index)
    except Exception as e:
        _raise_for(e)


@router.get("/{index}/wifi")
async def get_wifi(index: int):
    try:
        return {"enabled": await instance_service.get_wifi_status(index)}
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/mobile-data", response_model=ActionResponse)
async def set_mobile_data(index: int, body: ToggleRequest):
    try:
        await task_queue.enqueue(index, instance_service.set_mobile_data, index, body.enable)
        estado = "activados" if body.enable else "desactivados"
        return ActionResponse(success=True, message=f"Datos móviles {estado}", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/airplane-mode", response_model=ActionResponse)
async def set_airplane_mode(index: int, body: ToggleRequest):
    try:
        await task_queue.enqueue(index, instance_service.set_airplane_mode, index, body.enable)
        estado = "activado" if body.enable else "desactivado"
        return ActionResponse(success=True, message=f"Modo avión {estado}", index=index)
    except Exception as e:
        _raise_for(e)


# ======================================================================
# Ubicación / sensores
# ======================================================================
@router.post("/{index}/gps", response_model=ActionResponse)
async def set_gps(index: int, body: ToggleRequest):
    try:
        await task_queue.enqueue(index, instance_service.set_gps, index, body.enable)
        estado = "activado" if body.enable else "desactivado"
        return ActionResponse(success=True, message=f"GPS {estado}", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/geo", response_model=ActionResponse)
async def simulate_geo(index: int, body: GeoRequest):
    try:
        await task_queue.enqueue(index, instance_service.simulate_geo, index, body.lat, body.lon)
        return ActionResponse(
            success=True, message=f"Ubicación simulada: {body.lat}, {body.lon}", index=index
        )
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/rotation-lock", response_model=ActionResponse)
async def set_rotation_lock(index: int, body: RotationLockRequest):
    try:
        await task_queue.enqueue(index, instance_service.set_rotation_lock, index, body.locked)
        estado = "bloqueada" if body.locked else "libre"
        return ActionResponse(success=True, message=f"Rotación {estado}", index=index)
    except Exception as e:
        _raise_for(e)


# ======================================================================
# Interfaz: pantalla, volumen, DND
# ======================================================================
@router.post("/{index}/brightness", response_model=ActionResponse)
async def set_brightness(index: int, body: BrightnessRequest):
    try:
        await task_queue.enqueue(index, instance_service.set_brightness, index, body.level)
        return ActionResponse(success=True, message=f"Brillo fijado en {body.level}", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/screen-timeout", response_model=ActionResponse)
async def set_screen_timeout(index: int, body: ScreenTimeoutRequest):
    try:
        await task_queue.enqueue(index, instance_service.set_screen_timeout, index, body.ms)
        return ActionResponse(success=True, message=f"Timeout de pantalla: {body.ms}ms", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/volume", response_model=ActionResponse)
async def set_volume(index: int, body: VolumeRequest):
    try:
        await task_queue.enqueue(index, instance_service.set_volume, index, body.stream, body.level)
        return ActionResponse(
            success=True, message=f"Volumen {body.stream} fijado en {body.level}", index=index
        )
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/dnd", response_model=ActionResponse)
async def set_dnd(index: int, body: ToggleRequest):
    try:
        await task_queue.enqueue(index, instance_service.set_dnd, index, body.enable)
        estado = "activado" if body.enable else "desactivado"
        return ActionResponse(success=True, message=f"No molestar {estado}", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/screen/on", response_model=ActionResponse)
async def screen_on(index: int):
    try:
        await task_queue.enqueue(index, instance_service.screen_on, index)
        return ActionResponse(success=True, message="Pantalla encendida", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/screen/off", response_model=ActionResponse)
async def screen_off(index: int):
    try:
        await task_queue.enqueue(index, instance_service.screen_off, index)
        return ActionResponse(success=True, message="Pantalla apagada", index=index)
    except Exception as e:
        _raise_for(e)


@router.get("/{index}/screen")
async def get_screen_status(index: int):
    try:
        return {"on": await instance_service.get_screen_status(index)}
    except Exception as e:
        _raise_for(e)


# ======================================================================
# Input: teclas, texto, gestos
# ======================================================================
@router.post("/{index}/input/key", response_model=ActionResponse)
async def press_key(index: int, body: KeyRequest):
    try:
        await task_queue.enqueue(index, instance_service.press_key, index, body.keycode)
        return ActionResponse(success=True, message=f"Tecla {body.keycode} presionada", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/input/text", response_model=ActionResponse)
async def input_text(index: int, body: TextRequest):
    try:
        # Reemplazar {index} por el número real de la instancia
        text_with_index = body.text.replace("{index}", str(index))
        await task_queue.enqueue(index, instance_service.input_text, index, text_with_index)
        return ActionResponse(success=True, message="Texto insertado", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/input/tap", response_model=ActionResponse)
async def tap(index: int, body: TapRequest):
    try:
        await task_queue.enqueue(index, instance_service.tap, index, body.x, body.y)
        return ActionResponse(success=True, message=f"Tap en ({body.x}, {body.y})", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/input/swipe", response_model=ActionResponse)
async def swipe(index: int, body: SwipeRequest):
    try:
        await task_queue.enqueue(
            index, instance_service.swipe, index, body.x1, body.y1, body.x2, body.y2, body.duration_ms
        )
        return ActionResponse(success=True, message="Swipe ejecutado", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/input/long-press", response_model=ActionResponse)
async def long_press(index: int, body: LongPressRequest):
    try:
        await task_queue.enqueue(
            index, instance_service.long_press, index, body.x, body.y, body.duration_ms
        )
        return ActionResponse(success=True, message="Long press ejecutado", index=index)
    except Exception as e:
        _raise_for(e)


# ======================================================================
# Apps: extras (uninstall, force-stop, clear-data, permisos, play protect)
# ======================================================================
@router.post("/{index}/apps/uninstall", response_model=ActionResponse)
async def uninstall_app(index: int, body: PackageRequest):
    try:
        await task_queue.enqueue(index, instance_service.uninstall_app, index, body.package_name)
        return ActionResponse(success=True, message=f"{body.package_name} desinstalada", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/apps/force-stop", response_model=ActionResponse)
async def force_stop_app(index: int, body: PackageRequest):
    try:
        await task_queue.enqueue(index, instance_service.force_stop_app, index, body.package_name)
        return ActionResponse(success=True, message=f"{body.package_name} detenida", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/apps/clear-data", response_model=ActionResponse)
async def clear_app_data(index: int, body: PackageRequest):
    try:
        await task_queue.enqueue(index, instance_service.clear_app_data, index, body.package_name)
        return ActionResponse(success=True, message=f"Datos de {body.package_name} borrados", index=index)
    except Exception as e:
        _raise_for(e)


@router.get("/{index}/apps", response_model=List[str])
async def list_apps(index: int, only_third_party: bool = True):
    try:
        return await instance_service.list_apps(index, only_third_party)
    except Exception as e:
        _raise_for(e)


@router.get("/{index}/apps/current")
async def get_current_app(index: int):
    try:
        return {"package_name": await instance_service.get_current_app(index)}
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/apps/permissions/grant", response_model=ActionResponse)
async def grant_permission(index: int, body: PermissionRequest):
    try:
        await task_queue.enqueue(
            index, instance_service.grant_permission, index, body.package_name, body.permission
        )
        return ActionResponse(success=True, message=f"Permiso {body.permission} otorgado", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/apps/permissions/revoke", response_model=ActionResponse)
async def revoke_permission(index: int, body: PermissionRequest):
    try:
        await task_queue.enqueue(
            index, instance_service.revoke_permission, index, body.package_name, body.permission
        )
        return ActionResponse(success=True, message=f"Permiso {body.permission} revocado", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/apps/play-protect", response_model=ActionResponse)
async def set_play_protect(index: int, body: PlayProtectRequest):
    try:
        await task_queue.enqueue(index, instance_service.set_play_protect, index, body.disable)
        estado = "desactivado" if body.disable else "activado"
        return ActionResponse(success=True, message=f"Play Protect {estado}", index=index)
    except Exception as e:
        _raise_for(e)
# ======================================================================
# Fase 2: escucha de toques reales del dispositivo (percepción, no inyección)
# ======================================================================
@router.post("/{index}/touch/start", response_model=TouchStatusResponse)
async def start_touch_listening(index: int):
    try:
        return await touch_service.start(index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/touch/stop", response_model=TouchStopResponse)
async def stop_touch_listening(index: int):
    try:
        return await touch_service.stop(index)
    except Exception as e:
        _raise_for(e)


# ======================================================================
# run_app confiable — complementa el /run "rápido" de instances.py
# ======================================================================
@router.post("/{index}/apps/run-reliable")
async def run_app_reliable(index: int, body: RunAppReliableRequest):
    """
    Variante robusta de /instances/{index}/run: confirma foreground vía ADB
    y hace fallback automático si ldconsole runapp no lo logra en timeout_s.
    Se enqueue igual que el resto para no pisar otros comandos en la misma
    instancia, pero devuelve info extra sobre qué método funcionó.
    """
    try:
        result = await task_queue.enqueue(
            index,
            instance_service.run_app_reliable,
            index,
            body.package_name,
            body.activity,
            body.timeout_s,
        )
        return {
            "success": True,
            "index": index,
            "package_name": body.package_name,
            **result,
        }
    except RuntimeError as e:
        raise HTTPException(status_code=504, detail=str(e))
    except Exception as e:
        _raise_for(e)

# ======================================================================
# ROOT / Depuración
# ======================================================================
@router.get("/{index}/root/status")
async def get_root_status(index: int):
    """Diagnóstico completo: serial, uid del shell, y estado de root."""
    try:
        return await instance_service.test_debug_mode(index)
    except Exception as e:
        _raise_for(e)


@router.get("/{index}/root/check")
async def check_root(index: int):
    try:
        return {"root": await instance_service.is_root(index)}
    except Exception as e:
        _raise_for(e)


@router.get("/{index}/root/ensure")
async def ensure_root(index: int):
    """Valida y loguea si root está disponible; no falla si no lo está."""
    try:
        available = await instance_service.ensure_root(index)
        return {"index": index, "root_available": available}
    except Exception as e:
        _raise_for(e)


@router.get("/{index}/uid")
async def get_uid(index: int):
    try:
        return {"uid": await instance_service.get_uid(index)}
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/root/shell", response_model=ActionResponse)
async def root_shell(index: int, body: RootShellRequest):
    """
    Ejecuta un comando arbitrario como root (`su -c`). Se enqueue para no
    pisar otros comandos en la misma instancia. Requiere que la instancia
    tenga root habilitado en la config de LDPlayer.
    """
    try:
        # timeout defensivo: es la única ruta donde el usuario controla
        # el comando que se ejecuta (`su -c ...`), así que acotamos
        # cuánto puede colgar el fetch del cliente si el comando se traba.
        output = await task_queue.enqueue(
            index, instance_service.root_shell, index, body.command, timeout=30,
        )
        return ActionResponse(success=True, message=output.strip() or "OK", index=index)
    except Exception as e:
        _raise_for(e)