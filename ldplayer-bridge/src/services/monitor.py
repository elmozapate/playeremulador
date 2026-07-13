"""
Refresca en background el estado de todas las instancias (polling).
FIX vs versión anterior: expone `invalidate(index)` en vez de que otros
módulos manipulen `monitor.cache` directamente (encapsulamiento).
"""
import asyncio
from typing import Any, Dict, Optional

from config import settings
from services.instance_service import instance_service


class InstanceMonitor:
    def __init__(self):
        self._cache: Dict[int, Dict[str, Any]] = {}
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
                print(f"[monitor] error actualizando cache: {e}")
            await asyncio.sleep(settings.MONITOR_INTERVAL)

    async def _refresh(self) -> None:
        instances = await instance_service.list_instances()
        active_indices = set()
        for inst in instances:
            idx = inst["index"]
            active_indices.add(idx)
            health = await instance_service.get_health(idx, use_cache=False)
            self._cache[idx] = {**inst, "battery": health.get("battery")}
        for idx in list(self._cache.keys()):
            if idx not in active_indices:
                self._cache.pop(idx, None)

    def invalidate(self, index: int) -> None:
        self._cache.pop(index, None)

    def get_status(self, index: int) -> Optional[Dict[str, Any]]:
        return self._cache.get(index)

    def get_all_status(self) -> Dict[int, Dict[str, Any]]:
        return self._cache
   
    def invalidate_all(self) -> None:
       self._cache.clear()

monitor = InstanceMonitor()
