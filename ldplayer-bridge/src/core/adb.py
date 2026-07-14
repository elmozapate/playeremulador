"""
Wrapper de bajo nivel sobre adb. Bloqueante; despachar con asyncio.to_thread
desde código async.
"""
import re
import subprocess
from typing import Dict, List, Optional

from config import settings

BATTERY_HEALTH_MAP = {
    "1": "unknown",
    "2": "good",
    "3": "overheat",
    "4": "dead",
    "5": "over_voltage",
    "6": "unspecified_failure",
    "7": "cold",
}

BATTERY_STATUS_MAP = {
    "1": "unknown",
    "2": "charging",
    "3": "discharging",
    "4": "not_charging",
    "5": "full",
}

VOLUME_STREAMS = {
    "voice_call": 0,
    "system": 1,
    "ring": 2,
    "music": 3,
    "alarm": 4,
    "notification": 5,
}

# keyevent más usados, por si querés exponer nombres en vez de códigos
KEYEVENTS = {
    "home": 3,
    "back": 4,
    "power": 26,
    "menu": 82,
    "volume_up": 24,
    "volume_down": 25,
    "camera": 27,
    "app_switch": 187,
    "enter": 66,
    "delete": 67,
}


class ADBController:
    # ------------------------------------------------------------------
    # Núcleo / conexión
    # ------------------------------------------------------------------
    @staticmethod
    def get_port(index: int) -> int:
        return settings.ADB_BASE_PORT + (index * 2)

    @staticmethod
    def connect(index: int) -> None:
        port = ADBController.get_port(index)
        subprocess.run(
            [settings.ADB_PATH, "connect", f"127.0.0.1:{port}"],
            capture_output=True, text=True,
        )

    @staticmethod
    def shell(index: int, command: str) -> str:
        ADBController.connect(index)
        port = ADBController.get_port(index)
        result = subprocess.run(
            [settings.ADB_PATH, "-s", f"127.0.0.1:{port}", "shell", command],
            capture_output=True, text=True,
        )
        return result.stdout

    @staticmethod
    def shell_ok(index: int, command: str) -> bool:
        """Como shell(), pero devuelve True/False según returncode."""
        ADBController.connect(index)
        port = ADBController.get_port(index)
        result = subprocess.run(
            [settings.ADB_PATH, "-s", f"127.0.0.1:{port}", "shell", command],
            capture_output=True, text=True,
        )
        return result.returncode == 0

    # ------------------------------------------------------------------
    # Batería
    # ------------------------------------------------------------------
    @staticmethod
    def get_battery_health(index: int) -> Dict:
        """Parsea `dumpsys battery` a un dict estable."""
        output = ADBController.shell(index, "dumpsys battery")
        data: Dict = {}
        for line in output.splitlines():
            if ":" not in line:
                continue
            key, value = (p.strip() for p in line.split(":", 1))
            if key == "health":
                data["health"] = BATTERY_HEALTH_MAP.get(value, "unknown")
            elif key == "level" and value.isdigit():
                data["level"] = int(value)
            elif key == "status":
                data["status"] = BATTERY_STATUS_MAP.get(value, "unknown")
            elif key == "temperature" and value.lstrip("-").isdigit():
                data["temperature_c"] = int(value) / 10.0
        return data

    @staticmethod
    def set_battery_level(index: int, level: int) -> str:
        """Establece el nivel de batería simulado (0-100)."""
        level = max(0, min(100, level))
        return ADBController.shell(index, f"dumpsys battery set level {level}")

    @staticmethod
    def set_battery_status(index: int, status: str) -> str:
        """status: 'charging'|'discharging'|'not_charging'|'full'|'unknown'"""
        codes = {v: k for k, v in BATTERY_STATUS_MAP.items()}
        code = codes.get(status, "2")
        return ADBController.shell(index, f"dumpsys battery set status {code}")

    @staticmethod
    def reset_battery(index: int) -> str:
        """Restaura la batería a su estado real (deshace los `set`)."""
        return ADBController.shell(index, "dumpsys battery reset")

    # ------------------------------------------------------------------
    # Radios: bluetooth / wifi / datos móviles / modo avión
    # ------------------------------------------------------------------
    @staticmethod
    def set_bluetooth(index: int, enable: bool) -> str:
        """Activa o desactiva Bluetooth vía svc (no requiere root)."""
        state = "enable" if enable else "disable"
        return ADBController.shell(index, f"svc bluetooth {state}")

    @staticmethod
    def get_bluetooth_status(index: int) -> bool:
        output = ADBController.shell(index, "settings get global bluetooth_on")
        return output.strip() == "1"

    @staticmethod
    def set_wifi(index: int, enable: bool) -> str:
        state = "enable" if enable else "disable"
        return ADBController.shell(index, f"svc wifi {state}")

    @staticmethod
    def get_wifi_status(index: int) -> bool:
        output = ADBController.shell(index, "settings get global wifi_on")
        return output.strip() == "1"

    @staticmethod
    def toggle_mobile_data(index: int, enable: bool) -> str:
        state = "enable" if enable else "disable"
        return ADBController.shell(index, f"svc data {state}")

    @staticmethod
    def set_airplane_mode(index: int, enable: bool) -> str:
        value = "1" if enable else "0"
        ADBController.shell(index, f"settings put global airplane_mode_on {value}")
        return ADBController.shell(
            index,
            f"am broadcast -a android.intent.action.AIRPLANE_MODE --ez state {str(enable).lower()}",
        )

    # ------------------------------------------------------------------
    # Ubicación / sensores
    # ------------------------------------------------------------------
    @staticmethod
    def set_gps(index: int, enable: bool) -> str:
        mode = "3" if enable else "0"  # 3 = alta precisión, 0 = apagado
        return ADBController.shell(index, f"settings put secure location_mode {mode}")

    @staticmethod
    def simulate_gps_location(index: int, lat: float, lon: float) -> str:
        """Requiere que la instancia tenga un mock location provider activo."""
        return ADBController.shell(index, f"geo fix {lon} {lat}")

    @staticmethod
    def set_rotation_lock(index: int, locked: bool) -> str:
        value = "0" if locked else "1"
        return ADBController.shell(index, f"settings put system accelerometer_rotation {value}")

    # ------------------------------------------------------------------
    # Interfaz: pantalla, volumen, DND
    # ------------------------------------------------------------------
    @staticmethod
    def set_screen_brightness(index: int, level: int) -> str:
        """level: 0-255"""
        level = max(0, min(255, level))
        return ADBController.shell(index, f"settings put system screen_brightness {level}")

    @staticmethod
    def set_screen_timeout(index: int, ms: int) -> str:
        return ADBController.shell(index, f"settings put system screen_off_timeout {ms}")

    @staticmethod
    def set_volume(index: int, stream: str, level: int) -> str:
        """stream: 'music'|'ring'|'alarm'|'notification'|'system'|'voice_call'"""
        sid = VOLUME_STREAMS.get(stream, 3)
        return ADBController.shell(index, f"media volume --stream {sid} --set {level}")

    @staticmethod
    def set_do_not_disturb(index: int, enable: bool) -> str:
        mode = "1" if enable else "0"
        return ADBController.shell(index, f"settings put global zen_mode {mode}")

    @staticmethod
    def screen_on(index: int) -> str:
        return ADBController.shell(index, "input keyevent 224")  # KEYCODE_WAKEUP

    @staticmethod
    def screen_off(index: int) -> str:
        return ADBController.shell(index, "input keyevent 223")  # KEYCODE_SLEEP

    @staticmethod
    def is_screen_on(index: int) -> bool:
        output = ADBController.shell(index, "dumpsys power")
        match = re.search(r"mHoldingDisplaySuspendBlocker=(\w+)", output)
        if match:
            return match.group(1) == "true"
        return "mWakefulness=Awake" in output

    # ------------------------------------------------------------------
    # Input: teclas, texto, gestos
    # ------------------------------------------------------------------
    @staticmethod
    def press_key(index: int, keycode) -> str:
        """keycode puede ser int o nombre presente en KEYEVENTS."""
        code = KEYEVENTS.get(keycode, keycode) if isinstance(keycode, str) else keycode
        return ADBController.shell(index, f"input keyevent {code}")

    @staticmethod
    def input_text(index: int, text: str) -> str:
        escaped = text.replace(" ", "%s").replace("'", "\\'")
        return ADBController.shell(index, f"input text '{escaped}'")

    @staticmethod
    def tap(index: int, x: int, y: int) -> str:
        return ADBController.shell(index, f"input tap {x} {y}")

    @staticmethod
    def swipe(index: int, x1: int, y1: int, x2: int, y2: int, duration_ms: int = 300) -> str:
        return ADBController.shell(index, f"input swipe {x1} {y1} {x2} {y2} {duration_ms}")

    @staticmethod
    def long_press(index: int, x: int, y: int, duration_ms: int = 800) -> str:
        return ADBController.shell(index, f"input swipe {x} {y} {x} {y} {duration_ms}")

    # ------------------------------------------------------------------
    # Apps: instalar, lanzar, forzar cierre, desinstalar
    # ------------------------------------------------------------------
    @staticmethod
    def install_app(index: int, apk_path: str) -> str:
        ADBController.connect(index)
        port = ADBController.get_port(index)
        result = subprocess.run(
            [settings.ADB_PATH, "-s", f"127.0.0.1:{port}", "install", "-r", apk_path],
            capture_output=True, text=True,
        )
        return result.stdout or result.stderr

    @staticmethod
    def uninstall_app(index: int, package: str) -> str:
        ADBController.connect(index)
        port = ADBController.get_port(index)
        result = subprocess.run(
            [settings.ADB_PATH, "-s", f"127.0.0.1:{port}", "uninstall", package],
            capture_output=True, text=True,
        )
        return result.stdout or result.stderr

    @staticmethod
    def run_app(index: int, package: str, activity: Optional[str] = None) -> str:
        if activity:
            return ADBController.shell(index, f"am start -n {package}/{activity}")
        return ADBController.shell(
            index, f"monkey -p {package} -c android.intent.category.LAUNCHER 1"
        )

    @staticmethod
    def force_stop(index: int, package: str) -> str:
        return ADBController.shell(index, f"am force-stop {package}")

    @staticmethod
    def clear_app_data(index: int, package: str) -> str:
        return ADBController.shell(index, f"pm clear {package}")

    @staticmethod
    def list_packages(index: int, only_third_party: bool = True) -> List[str]:
        flag = "-3" if only_third_party else ""
        output = ADBController.shell(index, f"pm list packages {flag}")
        return [line.replace("package:", "").strip() for line in output.splitlines() if line.strip()]

    @staticmethod
    def get_current_app(index: int) -> Optional[str]:
        output = ADBController.shell(index, "dumpsys window windows")
        match = re.search(r"mCurrentFocus=.*?\s([\w.]+)/([\w.]+)", output)
        if match:
            return match.group(1)
        return None

    # ------------------------------------------------------------------
    # Permisos / seguridad
    # ------------------------------------------------------------------
    @staticmethod
    def set_play_protect(index: int, disable: bool) -> str:
        """Desactiva (-1) o reactiva (1) la verificación de Play Protect."""
        value = "-1" if disable else "1"
        return ADBController.shell(
            index, f"settings put global package_verifier_user_consent {value}"
        )

    @staticmethod
    def grant_permission(index: int, package: str, permission: str) -> str:
        return ADBController.shell(index, f"pm grant {package} {permission}")

    @staticmethod
    def revoke_permission(index: int, package: str, permission: str) -> str:
        return ADBController.shell(index, f"pm revoke {package} {permission}")

    # ------------------------------------------------------------------
    # Sistema / diagnóstico
    # ------------------------------------------------------------------
    @staticmethod
    def get_all_settings(index: int, namespace: str = "global") -> str:
        """namespace: 'system'|'secure'|'global' — para debug/inspección"""
        return ADBController.shell(index, f"settings list {namespace}")

    @staticmethod
    def get_prop(index: int, prop: str) -> str:
        return ADBController.shell(index, f"getprop {prop}").strip()

    @staticmethod
    def reboot(index: int) -> str:
        return ADBController.shell(index, "reboot")

    @staticmethod
    def get_ip_address(index: int) -> Optional[str]:
        output = ADBController.shell(index, "ip -f inet addr show wlan0")
        match = re.search(r"inet (\d+\.\d+\.\d+\.\d+)", output)
        return match.group(1) if match else None