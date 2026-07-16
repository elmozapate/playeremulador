"""
Refresca en background el estado de todas las instancias (polling) y lo
persiste en disco (DATA_DIR/status/all.json vía core.data_store), en vez
de guardarlo en un dict en memoria (self._cache) como antes.

v3: se eliminó el cache en memoria. Node lee directo el archivo
compartido en vez de pedirle este status a Python por HTTP y cachearlo
del otro lado; acá ya no hace falta duplicar ese estado. El intervalo de
refresco ahora sale de runtime_state.monitor_interval (configurable en
caliente vía POST /api/v1/debug/monitor-interval y persistido en disco),
no del settings.MONITOR_INTERVAL fijo de antes.
"""
import asyncio
from typing import Any, Dict, Optional

from core.adb import ADBController
from core.data_store import data_store
from core.runtime_state import runtime_state
from services.instance_service import instance_service


class InstanceMonitor:
    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _loop(self) -> None:
        while self._running:
            try:
                await self._refresh()
            except Exception as e:  # noqa: BLE001 - no tumbar el loop de monitoreo
                runtime_state.log_always(f"[monitor] error actualizando snapshot: {e}")
            await asyncio.sleep(runtime_state.monitor_interval)

    async def _refresh(self) -> None:
        instances = await instance_service.list_instances()
        active_indices = {inst["index"] for inst in instances}

        snapshot: Dict[str, Any] = {}
        for inst in instances:
            idx = inst["index"]
            # use_cache=True: solo pega a ADB si el health en disco venció
            # (runtime_state.health_ttl). Esto es lo que evita golpear ADB
            # de más con muchas instancias.
            health = await instance_service.get_health(idx, use_cache=True)
            snapshot[str(idx)] = {**inst, "battery": health.get("battery")}

        data_store.write_status_snapshot(snapshot)

        # Poda de archivos "aguas abajo" para que no se llenen con basura
        # de instancias clonadas/borradas con el tiempo.
        instance_service.prune_health_cache(active_indices)
        ADBController.prune(active_indices)

        runtime_state.log(f"[monitor] refresh ok: {len(instances)} instancias activas")

    def invalidate(self, index: int) -> None:
        data_store.delete_health(index)

    def get_status(self, index: int) -> Optional[Dict[str, Any]]:
        snapshot = data_store.read_status_snapshot() or {}
        return snapshot.get("instances", {}).get(str(index))

    def get_all_status(self) -> Dict[str, Any]:
        snapshot = data_store.read_status_snapshot() or {}
        return snapshot.get("instances", {})

    def invalidate_all(self) -> None:
        data_store.write_status_snapshot({})


monitor = InstanceMonitor()
