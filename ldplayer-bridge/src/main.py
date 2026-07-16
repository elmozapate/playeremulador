from contextlib import asynccontextmanager
import asyncio
import uvicorn
from fastapi import FastAPI
from api import router as api_router
from config import settings
from services.monitor import monitor
from services.window_service import window_service
from services.ws_bridge import router as ws_bridge_router, bridge as ws_bridge
from api.monitor_router import router as monitor_router
from fastapi.middleware.cors import CORSMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    from services.instance_record_store import instance_record_store
    instance_record_store.clear_orphan_locks()
    ws_bridge.bind_loop(asyncio.get_running_loop())
    await monitor.start()
    await window_service.start()
    yield
    await window_service.stop()
    await monitor.stop()


app = FastAPI(title="LDPlayer Service Manager", version="2.0", lifespan=lifespan)
app.include_router(api_router, prefix="/api/v1")
app.include_router(ws_bridge_router)  # /ws/bridge — fuera de /api/v1 a propósito, mismo path que espera Node
app.include_router(monitor_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # o restringí al origin real de tu dashboard
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "LDPlayer Service Manager running"}


if __name__ == "__main__":
    uvicorn.run("main:app", host=settings.API_HOST, port=settings.API_PORT, reload=True)