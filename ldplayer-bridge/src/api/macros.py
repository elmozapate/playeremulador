from typing import Dict, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.macro_service import MacroNotFoundError, macro_service

router = APIRouter()


class SaveMacroRequest(BaseModel):
    name: str
    steps: List[Dict]


def _raise_for(e: Exception):
    if isinstance(e, MacroNotFoundError):
        raise HTTPException(status_code=404, detail=str(e)) from e
    raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{index}/record/start")
async def start_recording(index: int):
    try:
        await macro_service.start_recording(index)
        return {"success": True, "index": index, "recording": True}
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/record/stop")
async def stop_recording(index: int):
    """Devuelve los gestos detectados (todavía sin guardar como task)."""
    try:
        steps = await macro_service.stop_recording(index)
        return {"success": True, "index": index, "steps": steps}
    except Exception as e:
        _raise_for(e)


@router.get("/{index}/record/status")
async def recording_status(index: int):
    return {"index": index, "recording": macro_service.is_recording(index)}


@router.post("/{index}/save")
async def save_task(index: int, body: SaveMacroRequest):
    return {"success": True, **macro_service.save_task(index, body.name, body.steps)}


@router.get("/{index}")
async def list_tasks(index: int):
    return macro_service.list_tasks(index)


@router.get("/{index}/{task_id}")
async def get_task(index: int, task_id: str):
    try:
        return macro_service.get_task(index, task_id)
    except Exception as e:
        _raise_for(e)


@router.post("/{index}/{task_id}/run")
async def run_task(index: int, task_id: str):
    try:
        result = await macro_service.run_task(index, task_id)
        return {"success": True, "index": index, "task_id": task_id, **result}
    except Exception as e:
        _raise_for(e)


@router.delete("/{index}/{task_id}")
async def delete_task(index: int, task_id: str):
    macro_service.delete_task(index, task_id)
    return {"success": True, "deleted": task_id}