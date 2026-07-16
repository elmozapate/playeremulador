from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from api import router as api_router
from config import settings
from services.monitor import monitor


@asynccontextmanager
async def lifespan(app: FastAPI):
    from services.instance_record_store import instance_record_store
    instance_record_store.clear_orphan_locks()
    await monitor.start()
    yield
    await monitor.stop()


app = FastAPI(title="LDPlayer Service Manager", version="2.0", lifespan=lifespan)
app.include_router(api_router, prefix="/api/v1")


@app.get("/")
async def root():
    return {"message": "LDPlayer Service Manager running"}


if __name__ == "__main__":
    uvicorn.run("main:app", host=settings.API_HOST, port=settings.API_PORT, reload=True)
