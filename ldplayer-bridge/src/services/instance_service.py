import asyncio
import traceback
import re
import subprocess
import time
import os
from typing import Dict, List, Optional
from config import settings
from core.ldplayer import LDConsole
from core.adb import ADBController
from core.data_store import data_store
from core.runtime_state import runtime_state
from services.instance_record_store import instance_record_store
from services.ws_bridge import notify_root_status
from services.window_service import window_service


class InstanceNotFoundError(Exception):
    pass


class InstanceService:
    def __init__(self):
        runtime_state.log("=" * 70)
        runtime_state.log("[INSTANCE SERVICE] CONFIG")
        runtime_state.log(f"[CONFIG] LDPLAYER_PATH={settings.LDPLAYER_PATH}")
        runtime_state.log(f"[CONFIG] ADB_PATH={settings.ADB_PATH}")
        runtime_state.log(f"[CONFIG] DATA_DIR={settings.DATA_DIR}")
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
        await asyncio.to_thread(instance_record_store.record_launch, index)
        # Vincula la ventana host recién creada con este index. Se dispara
        # en background (no se espera acá): LDPlayer puede tardar unos
        # segundos en crear la ventana y no queremos que el endpoint de
        # /launch (un fetch del cliente) quede colgado esperando eso.
        asyncio.create_task(self._register_window_safe(index))
    async def _register_window_safe(self, index: int) -> None:
        """Best-effort: si falla la vinculación de ventana, solo se
        loguea; nunca debe tumbar el flujo de arranque de la instancia."""
        try:
            await window_service.register_for_instance(index)
        except Exception as e:
            runtime_state.log_always(f"[INSTANCE] index={index}: no se pudo vincular ventana: {e}")
    async def reboot(self, index: int) -> None:
        await asyncio.to_thread(LDConsole.reboot, index)
        data_store.delete_health(index)
        ADBController.invalidate_serial(index)
        await asyncio.to_thread(instance_record_store.record_reboot, index)
        # esperar a que el dispositivo esté listo después de reiniciar
        await self._wait_for_device_ready_with_kill_retry(index)
    async def quit(self, index: int) -> None:
        await asyncio.to_thread(LDConsole.quit, index)
        data_store.delete_health(index)
        ADBController.invalidate_serial(index)
        await asyncio.to_thread(instance_record_store.record_quit, index)
        await window_service.unregister_for_instance(index)

    @staticmethod
    def _extract_package_name(apk_path: str) -> Optional[str]:
        """Intenta leer el package name real del APK con `aapt dump badging`
        (herramienta del Android SDK, corre en el host, no en el emulador).
        Si aapt no está instalado o falla, devuelve None: quien llame debe
        caer al nombre de archivo como fallback (documentando que en ese
        caso record_apk no correlacionará con uninstall/force-stop/etc,
        que sí usan el package_name real que manda el frontend)."""
        aapt_bin = os.getenv("AAPT_PATH", "aapt")
        try:
            result = subprocess.run(
                [aapt_bin, "dump", "badging", apk_path],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode == 0:
                match = re.search(r"package: name='([\w.]+)'", result.stdout)
                if match:
                    return match.group(1)
        except Exception:
            pass
        return None

    async def install_app(self, index: int, apk_path: str) -> None:
        await asyncio.to_thread(LDConsole.install_app, index, apk_path)
        package_name = await asyncio.to_thread(self._extract_package_name, apk_path)
        # Clave preferida: package_name real (correlaciona con uninstall/
        # force-stop/clear-data). Si no se pudo extraer (sin aapt), cae al
        # nombre de archivo como antes.
        apk_key = package_name or os.path.splitext(os.path.basename(apk_path))[0]
        await asyncio.to_thread(
            instance_record_store.record_apk, index, apk_key, "installed", apk_path
        )

    async def run_app(self, index: int, package_name: str) -> None:
        await asyncio.to_thread(LDConsole.run_app, index, package_name)

    async def modify(self, index: int, cpu: Optional[int] = None,
                     memory: Optional[int] = None, resolution: Optional[str] = None,
                     root: Optional[bool] = None) -> None:
        await asyncio.to_thread(LDConsole.modify, index, cpu, memory, resolution, root)
        profile = {"cpu": cpu, "memory": memory, "resolution": resolution, "root": root}
        await asyncio.to_thread(instance_record_store.record_profile, index, profile)

    async def clone(self, index: int, new_name: str) -> None:
        await asyncio.to_thread(LDConsole.clone, source_index=index, new_name=new_name)

    async def kill_app(self, index: int, package_name: str) -> None:
        await asyncio.to_thread(LDConsole.kill_app, index, package_name)

    async def get_health(self, index: int, use_cache: bool = True) -> Dict:
        now = time.time()
        ttl = runtime_state.health_ttl

        if use_cache:
            cached = data_store.read_health(index)
            if cached and (now - cached.get("updated_at", 0)) < ttl:
                return cached["health"]

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

        data_store.write_health(index, health)
        await asyncio.to_thread(instance_record_store.record_health, index, inst["name"], health)
        return health

    def prune_health_cache(self, active_indices: set) -> None:
        data_store.prune_health(active_indices)

    # ==================================================================
    # Batería
    # ==================================================================
    async def set_battery_level(self, index: int, level: int) -> None:
        await asyncio.to_thread(ADBController.set_battery_level, index, level)
        data_store.delete_health(index)

    async def set_battery_status(self, index: int, status: str) -> None:
        await asyncio.to_thread(ADBController.set_battery_status, index, status)
        data_store.delete_health(index)

    async def reset_battery(self, index: int) -> None:
        await asyncio.to_thread(ADBController.reset_battery, index)
        data_store.delete_health(index)

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
        result = await asyncio.to_thread(ADBController.uninstall_app, index, package_name)
        status = "uninstalled" if "Success" in result else "uninstall_failed"
        await asyncio.to_thread(instance_record_store.record_apk, index, package_name, status)
        return result

    async def force_stop_app(self, index: int, package_name: str) -> str:
        result = await asyncio.to_thread(ADBController.force_stop, index, package_name)
        await asyncio.to_thread(instance_record_store.record_apk, index, package_name, "force_stopped")
        return result

    async def clear_app_data(self, index: int, package_name: str) -> str:
        result = await asyncio.to_thread(ADBController.clear_app_data, index, package_name)
        status = "data_cleared" if "Success" in result else "data_clear_failed"
        await asyncio.to_thread(instance_record_store.record_apk, index, package_name, status)
        return result

    async def list_apps(self, index: int, only_third_party: bool = True) -> List[str]:
        return await asyncio.to_thread(ADBController.list_packages, index, only_third_party)

    async def get_current_app(self, index: int) -> Optional[str]:
        return await asyncio.to_thread(ADBController.get_current_app, index)

    async def grant_permission(self, index: int, package_name: str, permission: str) -> str:
        result = await asyncio.to_thread(
            ADBController.grant_permission, index, package_name, permission
        )
        await asyncio.to_thread(instance_record_store.record_permission, index, package_name, permission, True)
        return result

    async def revoke_permission(self, index: int, package_name: str, permission: str) -> str:
        result = await asyncio.to_thread(
            ADBController.revoke_permission, index, package_name, permission
        )
        await asyncio.to_thread(instance_record_store.record_permission, index, package_name, permission, False)
        return result

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
    # HELPERS PARA ESPERA DE DISPOSITIVO LISTO (NUEVOS)
    # ==================================================================
    async def wait_for_device_ready(self, index: int, timeout: float = 60) -> None:
        """API pública: espera a que ADB responda, con reintento
        kill+launch si el dispositivo no arranca a tiempo."""
        await self._wait_for_device_ready_with_kill_retry(index, timeout)
    
    async def _wait_for_device_ready(self, index: int, timeout: float = 60) -> None:
        """Espera 'pura' (sin kill-retry): reintenta pegarle a ADB hasta
        `timeout`s. Lanza TimeoutError si nunca respondió."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                await asyncio.to_thread(ADBController.get_battery_health, index)
                return
            except Exception:
                await asyncio.sleep(1)
        raise TimeoutError(f"El dispositivo {index} no respondió después de {timeout}s")
    async def _wait_for_device_ready_with_kill_retry(self, index: int, timeout: float = 60) -> None:
        """
        Espera a que el dispositivo esté listo.
        Si tarda más de `timeout` segundos, lo mata y lo vuelve a encender una sola vez.
        Si después de ese segundo intento sigue sin responder, lanza RuntimeError.
        """
        try:
            await self._wait_for_device_ready(index, timeout)
            return
        except TimeoutError:
            runtime_state.log(
                f"[INSTANCE] El dispositivo {index} no respondió en {timeout}s. "
                "Se procede a matarlo y reiniciarlo."
            )
        try:
            await self.quit(index)
            await self.launch(index)
            await self._wait_for_device_ready(index, timeout)
        except TimeoutError:
            raise RuntimeError(
                f"El dispositivo {index} sigue sin estar listo después de kill+launch. Marcado como fail."
            )
    # ==================================================================
    # Perfiles de configuración: initial-root / ready
    # ==================================================================
    async def initial_root(self, index: int) -> Dict:
        last_error = None

        for attempt in range(1, 4):
            try:
                runtime_state.log(
                    f"[INITIAL_ROOT] [{index}] Iniciando intento {attempt}/3..."
                )

                await asyncio.to_thread(
                    LDConsole.modify,
                    index,
                    2,
                    2048,
                    "540,960,240",
                    None,
                )

                await asyncio.to_thread(
                    LDConsole.restart_with_dev_mode,
                    index,
                )

                data_store.delete_health(index)
                ADBController.invalidate_serial(index)

                await self._wait_for_device_ready_with_kill_retry(index)

                asyncio.create_task(self._register_window_safe(index))

                result = {
                    "index": index,
                    "cpu": 2,
                    "memory": 2048,
                    "resolution": "540,960,240",
                    "root_requested": True,
                }

                try:
                    await asyncio.to_thread(
                        ADBController.enable_adb_debugging,
                        index,
                    )
                    result["adb_debugging"] = True
                except Exception as e:
                    result["adb_debugging"] = False
                    result["adb_debugging_error"] = str(e)

                try:
                    result["root_active"] = await asyncio.to_thread(
                        ADBController.ensure_root,
                        index,
                    )
                except Exception as e:
                    result["root_active"] = False
                    result["root_error"] = str(e)

                await notify_root_status(index, bool(result.get("root_active")))

                await asyncio.to_thread(
                    instance_record_store.add_event,
                    index,
                    "profile",
                    "Perfil aplicado: initial-root (cpu=2 mem=2048)",
                )

                await asyncio.to_thread(
                    instance_record_store.record_profile,
                    index,
                    {
                        "cpu": 2,
                        "memory": 2048,
                        "resolution": "540,960,240",
                        "root": result.get("root_active"),
                        "adb_debug": 2 if result.get("adb_debugging") else None,
                    },
                )

                runtime_state.log(
                    f"[INITIAL_ROOT] [{index}] Finalizado correctamente."
                )

                return result

            except Exception as e:
                last_error = e

                runtime_state.log(
                    f"[INITIAL_ROOT] [{index}] ERROR intento {attempt}/3\n"
                    f"{type(e).__name__}: {e}\n"
                    f"{traceback.format_exc()}"
                )

                if attempt < 3:
                    runtime_state.log(
                        f"[INITIAL_ROOT] [{index}] "
                        "Reintentando en 15 segundos..."
                    )
                    await asyncio.sleep(15)

        runtime_state.log(
            f"[INITIAL_ROOT] [{index}] "
            f"Falló definitivamente después de 3 intentos.\n{last_error}"
        )

        raise last_error

    async def make_ready(self, index: int) -> Dict:
        await asyncio.to_thread(LDConsole.modify, index, 3, 3072, None, None)
        data_store.delete_health(index)
        await asyncio.to_thread(
            instance_record_store.add_event, index, "profile", "Perfil aplicado: ready (cpu=3 mem=3072)"
        )
        await asyncio.to_thread(
            instance_record_store.record_profile, index, {"cpu": 3, "memory": 3072}
        )
        return {"index": index, "cpu": 3, "memory": 3072}


# Instancia única (singleton)
instance_service = InstanceService()