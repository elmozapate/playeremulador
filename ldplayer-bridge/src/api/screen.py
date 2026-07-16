import asyncio
from fastapi import APIRouter, HTTPException, Response
from core.adb import ADBController
from services.instance_service import InstanceNotFoundError

router = APIRouter()


def _raise_for(e: Exception):
    if isinstance(e, InstanceNotFoundError):
        raise HTTPException(status_code=404, detail=str(e)) from e
    raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/{index}/screen/screenshot")
async def get_screenshot(index: int):
    """PNG crudo de la pantalla actual. Base del selector visual de click."""
    try:
        png = await asyncio.to_thread(ADBController.screenshot, index)
        return Response(content=png, media_type="image/png")
    except Exception as e:
        _raise_for(e)


@router.get("/{index}/screen/resolution")
async def get_resolution(index: int):
    try:
        return await asyncio.to_thread(ADBController.get_screen_resolution, index)
    except Exception as e:
        _raise_for(e)