# src/api/__init__.py
from fastapi import APIRouter

from .instances import router as instances_router
from .status import router as status_router

router = APIRouter()
router.include_router(instances_router, prefix="/instances", tags=["Instances"])
router.include_router(status_router, prefix="/status", tags=["Status"])

__all__ = ["router"]
