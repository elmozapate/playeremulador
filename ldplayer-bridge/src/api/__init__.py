from fastapi import APIRouter
from .debug import router as debug_router
from .instances import router as instances_router
from .status import router as status_router
from .system import router as system_router
from .endpoints.system import router as warmup_router
from .windows import router as windows_router

router = APIRouter()
router.include_router(instances_router, prefix="/instances", tags=["Instances"])
router.include_router(status_router, prefix="/status", tags=["Status"])
router.include_router(system_router, prefix="/instances", tags=["System"])
router.include_router(warmup_router, prefix="/instances", tags=["System"])
router.include_router(debug_router, prefix="/debug", tags=["Debug"])
router.include_router(windows_router, prefix="/windows", tags=["Windows"])
__all__ = ["router"]