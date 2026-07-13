"""
Capa de servicio: coordina core.LDConsole + core.ADBController, y expone
una API 100% async (offload de las llamadas bloqueantes vía asyncio.to_thread).
Reemplaza a ldplayer/instance.py y a get_instance() de api/routes.py.
"""
import asyncio
import time
from typing import Dict, List, Optional

from config import settings
from core.ldplayer import LDConsole
from core.adb import ADBController


class InstanceNotFoundError(Exception):
    pass


class InstanceService:
    def __init__(self):
        self._health_cache: Dict[int, Dict] = {}
        self._health_ts: Dict[int, float] = {}

    async def list_instances(self) -> List[Dict]:
        return await asyncio.to_thread(LDConsole.list_instances)

    async def get_instance(self, index: int) -> Dict:
        for inst in await self.list_instances():
            if inst["index"] == index:
                return inst
        raise InstanceNotFoundError(f"Instancia {index} no encontrada")

    async def launch(self, index: int) -> None:
        await self.get_instance(index)  # valida existencia antes de lanzar
        await asyncio.to_thread(LDConsole.launch, index)

    async def reboot(self, index: int) -> None:
        await self.get_instance(index)
        await asyncio.to_thread(LDConsole.reboot, index)
        self._health_cache.pop(index, None)
        self._health_ts.pop(index, None)

    async def quit(self, index: int) -> None:
        await self.get_instance(index)
        await asyncio.to_thread(LDConsole.quit, index)
        self._health_cache.pop(index, None)
        self._health_ts.pop(index, None)

    async def install_app(self, index: int, apk_path: str) -> None:
        await asyncio.to_thread(LDConsole.install_app, index, apk_path)

    async def run_app(self, index: int, package_name: str) -> None:
        await asyncio.to_thread(LDConsole.run_app, index, package_name)

    async def modify(self, index: int, cpu: Optional[int] = None,
                      memory: Optional[int] = None, resolution: Optional[str] = None) -> None:
        await asyncio.to_thread(LDConsole.modify, index, cpu, memory, resolution)

    async def clone(self, index: int, new_name: Optional[str] = None) -> None:
        await self.get_instance(index)
        await asyncio.to_thread(LDConsole.clone, index, None, new_name)

    async def get_health(self, index: int, use_cache: bool = True) -> Dict:
        now = time.time()
        if use_cache and index in self._health_cache and \
                (now - self._health_ts.get(index, 0)) < settings.HEALTH_CACHE_TTL:
            return self._health_cache[index]

        inst = await self.get_instance(index)
        health: Dict = {
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


# Instancia única compartida por toda la app (equivalente a un singleton simple)
instance_service = InstanceService()
