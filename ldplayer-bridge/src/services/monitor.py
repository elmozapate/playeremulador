"""
Refresca en background el estado de todas las instancias (polling).

FIX vs versión anterior: ya NO fuerza use_cache=False en cada ciclo —
antes eso significaba pegarle a ADB por cada instancia cada
MONITOR_INTERVAL segundos sin importar el TTL configurado, que era el
verdadero cuello de botella con muchas instancias. Ahora respeta el
health cache (runtime_state.health_ttl) y además poda, en cada ciclo,
los caches de instance_service y ADBController para índices que ya no
existen (evita que se "llenen" con instancias clonadas/borradas).
"""
import asyncio
from typing import Any, Dict, Optional

from config import settings
from core.adb import ADBController
from core.runtime_state import runtime_state
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
                runtime_state.log_always(f"[monitor] error actualizando cache: {e}")
            await asyncio.sleep(settings.MONITOR_INTERVAL)

    async def _refresh(self) -> None:
        instances = await instance_service.list_instances()
        active_indices = {inst["index"] for inst in instances}

        for inst in instances:
            idx = inst["index"]
            # use_cache=True: solo pega a ADB si el health cacheado venció
            # (runtime_state.health_ttl). Esto es lo que evita golpear ADB
            # de más con muchas instancias.
            health = await instance_service.get_health(idx, use_cache=True)
            self._cache[idx] = {**inst, "battery": health.get("battery")}

        for idx in list(self._cache.keys()):
            if idx not in active_indices:
                self._cache.pop(idx, None)

        # Poda de caches "aguas abajo" para que no se llenen con basura
        # de instancias clonadas/borradas con el tiempo.
        instance_service.prune_health_cache(active_indices)
        ADBController.prune(active_indices)

        runtime_state.log(f"[monitor] refresh ok: {len(instances)} instancias activas")

    def invalidate(self, index: int) -> None:
        self._cache.pop(index, None)

    def get_status(self, index: int) -> Optional[Dict[str, Any]]:
        return self._cache.get(index)

    def get_all_status(self) -> Dict[int, Dict[str, Any]]:
        return self._cache

    def invalidate_all(self) -> None:
        self._cache.clear()


monitor = InstanceMonitor()