"""
Wrapper de bajo nivel sobre adb. Bloqueante; despachar con asyncio.to_thread
desde código async.
"""
import subprocess
from typing import Dict

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


class ADBController:
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
         return ADBController.shell(index, f"dumpsys battery set level {level}")

     @staticmethod
     def reset_battery(index: int) -> str:
         """Restaura la batería a su estado real."""
         return ADBController.shell(index, "dumpsys battery reset")

     @staticmethod
     def set_bluetooth(index: int, enable: bool) -> str:
         """Activa o desactiva el Bluetooth (requiere permisos)."""
         state = "1" if enable else "0"
         return ADBController.shell(index, f"service call bluetooth_manager {state}")