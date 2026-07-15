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

        runtime_state.log("=" * 70)
        runtime_state.log("[INSTANCE SERVICE] CONFIG")
        runtime_state.log(f"[CONFIG] LDPLAYER_PATH={settings.LDPLAYER_PATH}")
        runtime_state.log(f"[CONFIG] ADB_PATH={settings.ADB_PATH}")
        runtime_state.log(f"[CONFIG] HEALTH_CACHE_TTL inicial={runtime_state.health_ttl}s")
        runtime_state.log("=" * 70)

    # ==================================================================
    # Lifecycle (ldconsole)
    # ==================================================================
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
        await asyncio.to_thread(LDConsole.clone, source_index=index, new_name=new_name)

    async def kill_app(self, index: int, package_name: str) -> None:
        await asyncio.to_thread(LDConsole.kill_app, index, package_name)

    async def get_health(self, index: int, use_cache: bool = True) -> Dict:
        now = time.time()
        ttl = runtime_state.health_ttl
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

    # ==================================================================
    # Batería
    # ==================================================================
    async def set_battery_level(self, index: int, level: int) -> None:
        await asyncio.to_thread(ADBController.set_battery_level, index, level)
        self._health_cache.pop(index, None)

    async def set_battery_status(self, index: int, status: str) -> None:
        await asyncio.to_thread(ADBController.set_battery_status, index, status)
        self._health_cache.pop(index, None)

    async def reset_battery(self, index: int) -> None:
        await asyncio.to_thread(ADBController.reset_battery, index)
        self._health_cache.pop(index, None)

    # ==================================================================
    # Radios: bluetooth / wifi / datos / avión
    # ==================================================================
    async def set_bluetooth(self, index: int, enable: bool) -> None:
        await asyncio.to_thread(ADBController.set_bluetooth, index, enable)

    async def get_bluetooth_status(self, index: int) -> bool:
        return await asyncio.to_thread(ADBController.get_bluetooth_status, index)

    async def set_wifi(self, index: int, enable: bool) -> None:
        await asyncio.to_thread(ADBController.set_wifi, index, enable)

    async def get_wifi_status(self, index: int) -> bool:
        return await asyncio.to_thread(ADBController.get_wifi_status, index)

    async def set_mobile_data(self, index: int, enable: bool) -> None:
        await asyncio.to_thread(ADBController.toggle_mobile_data, index, enable)

    async def set_airplane_mode(self, index: int, enable: bool) -> None:
        await asyncio.to_thread(ADBController.set_airplane_mode, index, enable)

    # ==================================================================
    # Ubicación / sensores
    # ==================================================================
    async def set_gps(self, index: int, enable: bool) -> None:
        await asyncio.to_thread(ADBController.set_gps, index, enable)

    async def simulate_geo(self, index: int, lat: float, lon: float) -> None:
        await asyncio.to_thread(ADBController.simulate_gps_location, index, lat, lon)

    async def set_rotation_lock(self, index: int, locked: bool) -> None:
        await asyncio.to_thread(ADBController.set_rotation_lock, index, locked)

    # ==================================================================
    # Interfaz: pantalla, volumen, DND
    # ==================================================================
    async def set_brightness(self, index: int, level: int) -> None:
        await asyncio.to_thread(ADBController.set_screen_brightness, index, level)

    async def set_screen_timeout(self, index: int, ms: int) -> None:
        await asyncio.to_thread(ADBController.set_screen_timeout, index, ms)

    async def set_volume(self, index: int, stream: str, level: int) -> None:
        await asyncio.to_thread(ADBController.set_volume, index, stream, level)

    async def set_dnd(self, index: int, enable: bool) -> None:
        await asyncio.to_thread(ADBController.set_do_not_disturb, index, enable)

    async def screen_on(self, index: int) -> None:
        await asyncio.to_thread(ADBController.screen_on, index)

    async def screen_off(self, index: int) -> None:
        await asyncio.to_thread(ADBController.screen_off, index)

    async def get_screen_status(self, index: int) -> bool:
        return await asyncio.to_thread(ADBController.is_screen_on, index)

    # ==================================================================
    # Input: teclas, texto, gestos
    # ==================================================================
    async def press_key(self, index: int, keycode) -> None:
        await asyncio.to_thread(ADBController.press_key, index, keycode)

    async def input_text(self, index: int, text: str) -> None:
        await asyncio.to_thread(ADBController.input_text, index, text)

    async def tap(self, index: int, x: int, y: int) -> None:
        await asyncio.to_thread(ADBController.tap, index, x, y)

    async def swipe(self, index: int, x1: int, y1: int, x2: int, y2: int,
                     duration_ms: int = 300) -> None:
        await asyncio.to_thread(ADBController.swipe, index, x1, y1, x2, y2, duration_ms)

    async def long_press(self, index: int, x: int, y: int, duration_ms: int = 800) -> None:
        await asyncio.to_thread(ADBController.long_press, index, x, y, duration_ms)

    # ==================================================================
    # Apps: extras que no cubre ldconsole
    # ==================================================================
    async def uninstall_app(self, index: int, package_name: str) -> str:
        return await asyncio.to_thread(ADBController.uninstall_app, index, package_name)

    async def force_stop_app(self, index: int, package_name: str) -> str:
        return await asyncio.to_thread(ADBController.force_stop, index, package_name)

    async def clear_app_data(self, index: int, package_name: str) -> str:
        return await asyncio.to_thread(ADBController.clear_app_data, index, package_name)

    async def list_apps(self, index: int, only_third_party: bool = True) -> List[str]:
        return await asyncio.to_thread(ADBController.list_packages, index, only_third_party)

    async def get_current_app(self, index: int) -> Optional[str]:
        return await asyncio.to_thread(ADBController.get_current_app, index)

    async def grant_permission(self, index: int, package_name: str, permission: str) -> str:
        return await asyncio.to_thread(
            ADBController.grant_permission, index, package_name, permission
        )

    async def revoke_permission(self, index: int, package_name: str, permission: str) -> str:
        return await asyncio.to_thread(
            ADBController.revoke_permission, index, package_name, permission
        )

    async def set_play_protect(self, index: int, disable: bool) -> str:
        return await asyncio.to_thread(ADBController.set_play_protect, index, disable)

    # ==================================================================
    # run_app confiable: ldconsole + confirmación + fallback ADB
    # ==================================================================
    async def run_app_reliable(self, index: int, package_name: str,
                                activity: Optional[str] = None,
                                timeout_s: float = 6.0) -> Dict:
        try:
            await asyncio.to_thread(LDConsole.run_app, index, package_name)
        except Exception:
            pass

        deadline = time.time() + timeout_s
        foreground = None
        while time.time() < deadline:
            foreground = await asyncio.to_thread(ADBController.get_current_app, index)
            if foreground == package_name:
                return {"method": "ldconsole", "foreground": foreground}
            await asyncio.sleep(0.5)

        await asyncio.to_thread(ADBController.run_app, index, package_name, activity)

        deadline = time.time() + timeout_s
        while time.time() < deadline:
            foreground = await asyncio.to_thread(ADBController.get_current_app, index)
            if foreground == package_name:
                return {"method": "adb_fallback", "foreground": foreground}
            await asyncio.sleep(0.5)

        raise RuntimeError(
            f"No se pudo confirmar el arranque de {package_name} "
            f"(último foreground: {foreground})"
        )

    # ==================================================================
    # ROOT / Depuración
    # ==================================================================
    async def is_root(self, index: int) -> bool:
        return await asyncio.to_thread(ADBController.is_root, index)

    async def root_shell(self, index: int, command: str) -> str:
        return await asyncio.to_thread(ADBController.root_shell, index, command)

    async def ensure_root(self, index: int) -> bool:
        return await asyncio.to_thread(ADBController.ensure_root, index)

    async def get_uid(self, index: int) -> str:
        return await asyncio.to_thread(ADBController.get_uid, index)

    async def get_root_uid(self, index: int) -> str:
        return await asyncio.to_thread(ADBController.get_root_uid, index)

    async def test_debug_mode(self, index: int) -> Dict:
        return await asyncio.to_thread(ADBController.test_debug_mode, index)

    # ==================================================================
    # Perfiles de configuración: initial-root / ready
    # ==================================================================
    async def initial_root(self, index: int) -> Dict:
        """
        Perfil de desarrollo: root + depuración ADB + máximos recursos
        (6 núcleos / 8192 MB) + resolución tipo mobile (540x960).
        """
        await asyncio.to_thread(
            LDConsole.modify, index, 4, 8192, "540,960,240", None
        )
        await asyncio.to_thread(
            LDConsole.restart_with_dev_mode,
            index,
        )
        self._health_cache.pop(index, None)
        ADBController.invalidate_serial(index)
        result = {
            "index": index,
            "cpu": 4,
            "memory": 8192,
            "resolution": "540,960,240",
            "root_requested": True,
        }
        try:
            await asyncio.to_thread(ADBController.enable_adb_debugging, index)
            result["adb_debugging"] = True
        except Exception as e:
            result["adb_debugging"] = False
            result["adb_debugging_error"] = str(e)
        try:
            result["root_active"] = await asyncio.to_thread(ADBController.ensure_root, index)
        except Exception as e:
            result["root_active"] = False
            result["root_error"] = str(e)
        return result

    async def make_ready(self, index: int) -> Dict:
        """
        Perfil 'ready': recursos estándar de uso (3 núcleos / 3072 MB).
        No toca resolución ni root — solo ajusta CPU/RAM.
        """
        await asyncio.to_thread(LDConsole.modify, index, 3, 3072, None, None)
        self._health_cache.pop(index, None)
        return {"index": index, "cpu": 3, "memory": 3072}


# Instancia única (singleton)
instance_service = InstanceService()