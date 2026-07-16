import asyncio
from typing import Dict, List
from fastapi import APIRouter, HTTPException
from core.ldplayer import LDConsole, LDConsoleError
from models.schemas import (
    ActionResponse,
    InstallAppRequest,
    ModifyRequest,
    RunAppRequest,
    KillAppRequest,
    CloneRequest,
)
from services.instance_service import InstanceNotFoundError, instance_service
from services.monitor import monitor
from services.task_queue import task_queue
router = APIRouter()
# NOTA: acá vivía un /system/warmup duplicado y roto (usaba ADBController
# sin importarlo). La versión funcional quedó en api/endpoints/system.py,
# montada con este mismo prefix desde api/__init__.py
# (path final igual: /api/v1/instances/system/warmup).
def _raise_for(e: Exception):
    if isinstance(e, InstanceNotFoundError):
        raise HTTPException(status_code=404, detail=str(e)) from e
    if isinstance(e, TimeoutError):
        raise HTTPException(status_code=504, detail=str(e)) from e
    if isinstance(e, (LDConsoleError, ValueError)):
        raise HTTPException(status_code=400, detail=str(e)) from e
    raise HTTPException(status_code=500, detail=str(e)) from e

@router.get("", response_model=List[Dict])
async def list_instances():
    return await instance_service.list_instances()


@router.get("/{index}")
async def get_instance(index: int):
    try:
        return await instance_service.get_instance(index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/launch", response_model=ActionResponse)
async def launch_instance(index: int):
    try:
        await task_queue.enqueue(index, instance_service.launch, index)
        return ActionResponse(success=True, message="Instancia lanzada", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/reboot", response_model=ActionResponse)
async def reboot_instance(index: int):
    try:
        await task_queue.enqueue(index, instance_service.reboot, index)
        return ActionResponse(success=True, message="Instancia reiniciada", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/quit", response_model=ActionResponse)
async def quit_instance(index: int):
    try:
        await task_queue.enqueue(index, instance_service.quit, index)
        monitor.invalidate(index)
        return ActionResponse(success=True, message="Instancia cerrada", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/quitall", response_model=dict)
async def quit_all_instances():
    try:
        await asyncio.to_thread(LDConsole.quitall)
        monitor.invalidate_all()
        return {"status": "ok", "message": "Todas las instancias cerradas"}
    except Exception as e:
        _raise_for(e)


@router.get("/{index}/health")
async def get_health(index: int):
    try:
        return await instance_service.get_health(index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/install", response_model=ActionResponse)
async def install_app(index: int, body: InstallAppRequest):
    try:
        await task_queue.enqueue(index, instance_service.install_app, index, body.apk_path)
        return ActionResponse(success=True, message="App instalada", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/run", response_model=ActionResponse)
async def run_app(index: int, body: RunAppRequest):
    try:
        await task_queue.enqueue(index, instance_service.run_app, index, body.package_name)
        return ActionResponse(success=True, message="App ejecutada", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/modify", response_model=ActionResponse)
async def modify_instance(index: int, body: ModifyRequest):
    try:
        await task_queue.enqueue(
            index, instance_service.modify, index, body.cpu, body.memory, body.resolution
        )
        monitor.invalidate(index)
        return ActionResponse(success=True, message="Instancia modificada", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/clone", response_model=ActionResponse)
async def clone_instance(index: int, body: CloneRequest):
    try:
        await task_queue.enqueue(index, instance_service.clone, index, body.new_name)
        return ActionResponse(success=True, message="Instancia clonada", index=index)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/kill", response_model=ActionResponse)
async def kill_app(index: int, body: KillAppRequest):
    """Cierra una aplicación abierta en la instancia."""
    try:
        await task_queue.enqueue(index, instance_service.kill_app, index, body.package_name)
        return ActionResponse(success=True, message=f"App {body.package_name} cerrada", index=index)
    except Exception as e:
        _raise_for(e)

@router.post("/{index}/initial-root")
async def initial_root(index: int):
    """Deja la instancia lista para desarrollo: root + ADB debug + 6 núcleos / 8192 MB / 540x960."""
    try:
        result = await task_queue.enqueue(index, instance_service.initial_root, index)
        monitor.invalidate(index)
        return {"success": True, "message": "Instancia configurada como initial-root", **result}
    except Exception as e:
        _raise_for(e)
@router.post("/{index}/ready")
async def make_ready(index: int):
    """Perfil normal: 3 núcleos / 3072 MB (sin tocar resolución ni root)."""
    try:
        result = await task_queue.enqueue(index, instance_service.make_ready, index)
        monitor.invalidate(index)
        return {"success": True, "message": "Instancia configurada como ready", **result}
    except Exception as e:
        _raise_for(e)

        