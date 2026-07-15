import asyncio
import time
from typing import Dict, List, Optional
from config import settings
from core.ldplayer import LDConsole
from core.adb import ADBController
from core.runtime_state import runtime_state


class InstanceNotFoundError(Exception):
    pass


class InstanceService:
    def __init__(self):
        self._health_cache: Dict[int, Dict] = {}
        self._health_ts: Dict[int, float] = {}

        # Antes esto se imprimía siempre al boot. Ahora solo con debug ON
        # para no ensuciar el arranque por default.
        runtime_state.log("=" * 70)
        runtime_state.log("[INSTANCE SERVICE] CONFIG")
        runtime_state.log(f"[CONFIG] LDPLAYER_PATH={settings.LDPLAYER_PATH}")
        runtime_state.log(f"[CONFIG] ADB_PATH={settings.ADB_PATH}")
        runtime_state.log(f"[CONFIG] HEALTH_CACHE_TTL inicial={runtime_state.health_ttl}s")
        runtime_state.log("=" * 70)

    async def list_instances(self) -> List[Dict]:
        return await asyncio.to_thread(LDConsole.list_instances)

    async def get_instance(self, index: int) -> Dict:
        instances = await self.list_instances()
        for inst in instances:
            if inst["index"] == index:
                return inst
        raise InstanceNotFoundError(f"Instancia {index} no encontrada")

    async def launch(self, index: int) -> None:
        await asyncio.to_thread(LDConsole.launch, index)
        # El puerto ADB real puede reasignarse en cada arranque; forzamos
        # que la próxima llamada a resolve_serial() vuelva a descubrirlo
        # por proceso en vez de reusar un serial potencialmente obsoleto.
        ADBController.invalidate_serial(index)

    async def reboot(self, index: int) -> None:
        await asyncio.to_thread(LDConsole.reboot, index)
        self._health_cache.pop(index, None)
        self._health_ts.pop(index, None)
        ADBController.invalidate_serial(index)

    async def quit(self, index: int) -> None:
        await asyncio.to_thread(LDConsole.quit, index)
        self._health_cache.pop(index, None)
        self._health_ts.pop(index, None)
        ADBController.invalidate_serial(index)

    async def install_app(self, index: int, apk_path: str) -> None:
        await asyncio.to_thread(LDConsole.install_app, index, apk_path)

    async def run_app(self, index: int, package_name: str) -> None:
        await asyncio.to_thread(LDConsole.run_app, index, package_name)

    async def modify(self, index: int, cpu: Optional[int] = None,
                     memory: Optional[int] = None, resolution: Optional[str] = None,
                     root: Optional[bool] = None) -> None:
        await asyncio.to_thread(LDConsole.modify, index, cpu, memory, resolution, root)

    async def clone(self, index: int, new_name: str) -> None:
        # Clona la instancia 'index' a un nuevo nombre
        await asyncio.to_thread(LDConsole.clone, source_index=index, new_name=new_name)

    async def kill_app(self, index: int, package_name: str) -> None:
        # Cierra una app específica
        await asyncio.to_thread(LDConsole.kill_app, index, package_name)

    async def get_health(self, index: int, use_cache: bool = True) -> Dict:
        now = time.time()
        ttl = runtime_state.health_ttl  # ahora configurable en runtime, no fijo del .env
        if use_cache and index in self._health_cache and (now - self._health_ts.get(index, 0)) < ttl:
            return self._health_cache[index]

        inst = await self.get_instance(index)
        health = {
            "index": inst["index"],
            "name": inst["name"],
            "android_started": inst["android_started"],
            "pid": inst["pid"],
            "battery": None,
        }
        if inst["android_started"]:
            try:
                health["battery"] = await asyncio.to_thread(ADBController.get_battery_health, index)
            except Exception as e:
                health["battery_error"] = str(e)
        self._health_cache[index] = health
        self._health_ts[index] = now
        return health

    def prune_health_cache(self, active_indices: set) -> None:
        stale = [idx for idx in self._health_cache if idx not in active_indices]
        if not stale:
            return
        for idx in stale:
            self._health_cache.pop(idx, None)
            self._health_ts.pop(idx, None)
        runtime_state.log(f"[instance_service] health cache podado: {stale}")

# Instancia única (singleton)
instance_service = InstanceService()