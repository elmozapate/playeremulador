from fastapi import APIRouter

from .debug import router as debug_router
from .instances import router as instances_router
from .status import router as status_router
from .system import router as system_router

router = APIRouter()
router.include_router(instances_router, prefix="/instances", tags=["Instances"])
router.include_router(status_router, prefix="/status", tags=["Status"])
router.include_router(system_router, prefix="/instances", tags=["System"])
router.include_router(debug_router, prefix="/debug", tags=["Debug"])

__all__ = ["router"]