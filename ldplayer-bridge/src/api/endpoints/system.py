from fastapi import APIRouter
from models.schemas import WarmupRequest
from services.instance_service import instance_service

router = APIRouter()


@router.post("/system/warmup")
async def warmup_instances(request: WarmupRequest):
    """
    Pre-lanza las instancias para calentar cachés y ADB.
    Este endpoint se toma todo el tiempo necesario (hasta timeout_sec por
    instancia) -- si lo llamás desde Node, usá un timeout de fetch >=
    len(indices) * timeout_sec.
    """
    results = {}
    for idx in request.indices:
        try:
            inst = await instance_service.get_instance(idx)
            if inst.get("pid") is not None and inst.get("android_started", False):
                await instance_service.wait_for_device_ready(idx, timeout=request.timeout_sec)
                results[idx] = {"status": "already_running", "pid": inst["pid"]}
                continue
            await instance_service.launch(idx)
            await instance_service.wait_for_device_ready(idx, timeout=request.timeout_sec)
            await instance_service.get_health(idx, use_cache=False)
            results[idx] = {"status": "warmed_up"}
        except Exception as e:
            results[idx] = {"status": "failed", "error": str(e)}
    return {"message": "Calentamiento completado", "results": results}