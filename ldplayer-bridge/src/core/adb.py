"""
Wrapper de bajo nivel sobre adb. Bloqueante; despachar con asyncio.to_thread
desde código async.

Historial de este archivo:
- v1: fórmula fija index -> puerto (ADB_BASE_PORT + index*2, emulator-5554+index*2).
      Rota en instalaciones con muchas instancias: el índice de LDPlayer NO
      garantiza esa relación con el puerto ADB real.
- v2: resolve_serial() con cache + reintento, pero seguía intentando la
      fórmula como PRIMER paso.
- v3 (este archivo): descubrimiento dinámico. Antes de suponer nada,
      preguntamos al sistema operativo qué puerto TCP está escuchando el
      proceso real de LDPlayer asociado a ese índice (pid / vbox_pid que
      entrega `ldconsole list2`). La fórmula vieja queda solo como último
      recurso, y se loguea como "no confiable" cuando se usa.
      Además, se calcula una huella de identidad del Android (serialno +
      boot serial + android_id) para detectar alias ADB duplicados —
      el mismo problema que documentaste en el diagnóstico
      (127.0.0.1:5557 == emulator-5556 == mismo Android).

Requiere `psutil` para el descubrimiento por proceso. Si no está instalado,
se usa un parser de `netstat -ano` como fallback (menos robusto pero sin
dependencias extra). Instalar con: pip install psutil
"""
import re
import subprocess
import threading
from typing import Dict, List, Optional

from config import settings

try:
    import psutil
    _HAS_PSUTIL = True
except ImportError:
    psutil = None
    _HAS_PSUTIL = False

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

    _serial_cache: Dict[int, str] = {}
    _serial_lock = threading.Lock()

    # Huella de identidad del Android detrás de cada índice, para detectar
    # alias ADB duplicados (dos serials distintos -> mismo dispositivo real).
    _identity_cache: Dict[int, str] = {}
    _identity_to_index: Dict[str, int] = {}

    # ================================================================
    # ADB DEVICES / CONEXIÓN BAJO NIVEL
    # ================================================================

    @staticmethod
    def _run_adb(*args):
        return subprocess.run(
            [settings.ADB_PATH, *args],
            capture_output=True,
            text=True,
        )

    @staticmethod
    def _get_devices() -> list[str]:
        result = ADBController._run_adb("devices")

        devices = []

        for line in result.stdout.splitlines():
            line = line.strip()

            if not line or line.startswith("List of devices"):
                continue

            parts = line.split()

            if len(parts) >= 2 and parts[1] == "device":
                devices.append(parts[0])

        return devices

    # ================================================================
    # IDENTIDAD REAL DEL ANDROID (para deduplicar alias ADB)
    # ================================================================

    @staticmethod
    def _get_device_identity(serial: str) -> str:
        """
        Huella estable del Android detrás de un serial ADB, independiente
        del alias (emulator-XXXX vs 127.0.0.1:PORT). Combina:
        ro.serialno + ro.boot.serial + android_id.
        Si dos serials distintos devuelven la misma huella, son el MISMO
        dispositivo (como viste en el diagnóstico con 5557 / emulator-5556).
        """
        parts = []

        for prop in ("ro.serialno", "ro.boot.serial"):
            result = ADBController._run_adb(
                "-s", serial, "shell", "getprop", prop
            )
            parts.append(result.stdout.strip())

        android_id_result = ADBController._run_adb(
            "-s", serial, "shell", "settings", "get", "secure", "android_id"
        )
        parts.append(android_id_result.stdout.strip())

        return "|".join(parts)

    @staticmethod
    def _register_identity(index: int, serial: str) -> None:
        """
        Calcula la identidad del dispositivo detrás de `serial` y detecta
        colisiones: si otro índice ya reclamó esa misma identidad, lo
        logueamos fuerte porque significa que dos índices de LDPlayer están
        resolviendo al mismo Android (bug de LDPlayer, no nuestro).
        """
        try:
            identity = ADBController._get_device_identity(serial)
        except Exception as e:
            print(f"[ADB] no se pudo calcular identidad para index={index}: {e}")
            return

        if not identity or identity == "||":
            return

        previous_owner = ADBController._identity_to_index.get(identity)

        if previous_owner is not None and previous_owner != index:
            print(
                f"[ADB] ALIAS DUPLICADO DETECTADO: index={index} y "
                f"index={previous_owner} resuelven al MISMO Android "
                f"(identity={identity}). Revisa la instancia en LDPlayer."
            )

        ADBController._identity_cache[index] = identity
        ADBController._identity_to_index[identity] = index

    # ================================================================
    # DESCUBRIMIENTO DINÁMICO DE PUERTO POR PROCESO (método confiable)
    # ================================================================

    @staticmethod
    def _candidate_ports_for_index(index: int) -> List[int]:
        """
        En vez de asumir index -> puerto por fórmula, preguntamos a
        `ldconsole list2` qué PID (pid / vbox_pid) corresponde a ese índice,
        y luego preguntamos al sistema operativo qué puertos TCP en
        127.0.0.1 tiene abiertos ESE proceso en concreto.
        """
        try:
            from core.ldplayer import LDConsole
            instances = LDConsole.list_instances()
        except Exception as e:
            print(f"[ADB] no se pudo listar instancias LDPlayer: {e}")
            return []

        info = next((i for i in instances if i["index"] == index), None)

        if not info:
            print(f"[ADB] index={index} no aparece en `ldconsole list2`")
            return []

        candidate_pids = [
            p for p in (info.get("pid"), info.get("vbox_pid")) if p
        ]

        ports: List[int] = []

        for pid in candidate_pids:
            ports.extend(ADBController._listening_ports(pid))

        # dedupe conservando orden de aparición
        seen = set()
        unique_ports = []

        for port in ports:
            if port not in seen:
                seen.add(port)
                unique_ports.append(port)

        print(f"[ADB] index={index} pids={candidate_pids} puertos_candidatos={unique_ports}")

        return unique_ports

    @staticmethod
    def _listening_ports(pid: int) -> List[int]:
        if _HAS_PSUTIL:
            return ADBController._listening_ports_psutil(pid)
        return ADBController._listening_ports_netstat(pid)

    @staticmethod
    def _listening_ports_psutil(pid: int) -> List[int]:
        try:
            proc = psutil.Process(pid)
        except psutil.NoSuchProcess:
            return []

        ports = []

        # `net_connections` (psutil >= 6) reemplaza a `connections`,
        # que está deprecado/eliminado en versiones nuevas.
        conn_fn = getattr(proc, "net_connections", None) or proc.connections

        try:
            for conn in conn_fn(kind="tcp"):
                if (
                    conn.status == psutil.CONN_LISTEN
                    and conn.laddr
                    and conn.laddr.ip in ("127.0.0.1", "0.0.0.0")
                ):
                    ports.append(conn.laddr.port)
        except (psutil.AccessDenied, AttributeError):
            pass

        return ports

    @staticmethod
    def _listening_ports_netstat(pid: int) -> List[int]:
        """Fallback sin psutil: parsea `netstat -ano` (Windows)."""
        try:
            result = subprocess.run(
                ["netstat", "-ano"], capture_output=True, text=True
            )
        except Exception:
            return []

        ports = []

        for line in result.stdout.splitlines():
            line = line.strip()

            if not line.startswith("TCP"):
                continue

            parts = line.split()

            if len(parts) < 5:
                continue

            _proto, local, _foreign, state, owner_pid = parts[:5]

            if state != "LISTENING":
                continue

            if not owner_pid.isdigit() or int(owner_pid) != pid:
                continue

            if ":" not in local:
                continue

            host, _, port_str = local.rpartition(":")

            if host not in ("127.0.0.1", "0.0.0.0"):
                continue

            if port_str.isdigit():
                ports.append(int(port_str))

        return ports

    @staticmethod
    def _try_port(port: int) -> Optional[str]:
        """Intenta conectar y valida que el serial quede en estado `device`."""
        serial = f"127.0.0.1:{port}"

        ADBController._run_adb("connect", serial)

        result = ADBController._run_adb("-s", serial, "get-state")

        if result.returncode == 0 and result.stdout.strip() == "device":
            return serial

        return None

    @staticmethod
    def _discover_serial_by_process(index: int) -> Optional[str]:
        """
        Estrategia principal (confiable): descubre el serial ADB real
        preguntando al proceso de LDPlayer asociado a este índice, sin
        asumir ninguna fórmula index -> puerto.
        """
        ports = ADBController._candidate_ports_for_index(index)

        for port in ports:
            serial = ADBController._try_port(port)

            if serial:
                print(f"[ADB] index={index} -> {serial} (descubierto por proceso)")
                return serial

        return None

    # ================================================================
    # RESOLVER SERIAL POR INDEX
    # ================================================================

    @staticmethod
    def resolve_serial(index: int, force: bool = False) -> str:

        with ADBController._serial_lock:

            if not force:
                cached = ADBController._serial_cache.get(index)

                if cached:
                    result = ADBController._run_adb(
                        "-s",
                        cached,
                        "get-state",
                    )

                    if (
                        result.returncode == 0
                        and result.stdout.strip() == "device"
                    ):
                        return cached

                    ADBController._serial_cache.pop(index, None)

            devices = ADBController._get_devices()

            print(
                f"[ADB] resolve index={index} "
                f"devices={devices}"
            )

            # --------------------------------------------------------
            # ESTRATEGIA 1 (confiable): descubrimiento dinámico por
            # proceso real de LDPlayer (pid / vbox_pid -> puertos TCP).
            # --------------------------------------------------------

            serial = ADBController._discover_serial_by_process(index)

            if serial:
                ADBController._serial_cache[index] = serial
                ADBController._register_identity(index, serial)
                return serial

            # --------------------------------------------------------
            # ESTRATEGIA 2 (fallback, NO confiable): fórmula fija.
            # Solo se usa si el descubrimiento por proceso falló
            # (p. ej. no hay psutil, o `list2` no devolvió pid válido).
            # --------------------------------------------------------

            print(
                f"[ADB] index={index}: descubrimiento por proceso falló, "
                f"cayendo a fórmula fija (NO CONFIABLE)"
            )

            emulator_serial = f"emulator-{5554 + (index * 2)}"

            if emulator_serial in devices:
                ADBController._serial_cache[index] = emulator_serial
                ADBController._register_identity(index, emulator_serial)

                print(
                    f"[ADB] index={index} -> "
                    f"{emulator_serial} (fórmula fija)"
                )

                return emulator_serial

            # --------------------------------------------------------
            # ESTRATEGIA 3 (fallback final, NO confiable): TCP histórico
            # --------------------------------------------------------

            tcp_port = settings.ADB_BASE_PORT + (index * 2)
            tcp_serial = f"127.0.0.1:{tcp_port}"

            ADBController._run_adb(
                "connect",
                tcp_serial,
            )

            devices = ADBController._get_devices()

            if tcp_serial in devices:
                ADBController._serial_cache[index] = tcp_serial
                ADBController._register_identity(index, tcp_serial)

                print(
                    f"[ADB] index={index} -> "
                    f"{tcp_serial} (fórmula fija TCP)"
                )

                return tcp_serial

            raise RuntimeError(
                f"No se encontró dispositivo ADB "
                f"para LDPlayer index={index}. "
                f"Devices={devices}"
            )

    # ================================================================
    # INVALIDAR CACHE
    # ================================================================

    @staticmethod
    def invalidate_serial(index: int):
        with ADBController._serial_lock:
            serial_removed = ADBController._serial_cache.pop(index, None)
            identity = ADBController._identity_cache.pop(index, None)

            if identity and ADBController._identity_to_index.get(identity) == index:
                ADBController._identity_to_index.pop(identity, None)

            if serial_removed:
                print(f"[ADB] cache invalidada para index={index} (era {serial_removed})")

    # ================================================================
    # SHELL (con retry automático si el serial cambió)
    # ================================================================

    @staticmethod
    def shell(index: int, command: str) -> str:

        serial = ADBController.resolve_serial(index)

        result = ADBController._run_adb(
            "-s",
            serial,
            "shell",
            command,
        )

        if result.returncode == 0:
            return result.stdout

        print(
            f"[ADB] shell fallo index={index} "
            f"serial={serial}: {result.stderr.strip()}"
        )

        # El serial pudo cambiar después de reboot/quit/launch
        ADBController.invalidate_serial(index)

        serial = ADBController.resolve_serial(
            index,
            force=True,
        )

        result = ADBController._run_adb(
            "-s",
            serial,
            "shell",
            command,
        )

        if result.returncode != 0:
            raise RuntimeError(
                f"ADB shell error index={index} "
                f"serial={serial}: "
                f"{result.stderr.strip()}"
            )

        return result.stdout

    @staticmethod
    def shell_ok(index: int, command: str) -> bool:

        try:
            serial = ADBController.resolve_serial(index)

            result = ADBController._run_adb(
                "-s",
                serial,
                "shell",
                command,
            )

            return result.returncode == 0

        except Exception:
            return False

    # ================================================================
    # COMANDOS ADB NO-SHELL (install / uninstall) CON MISMO RETRY
    # ================================================================

    @staticmethod
    def _run_adb_on_device(index: int, *args) -> subprocess.CompletedProcess:
        """Ejecuta un comando adb (no `shell`) contra el serial resuelto,
        con el mismo reintento que `shell()` en caso de fallo."""

        serial = ADBController.resolve_serial(index)

        result = ADBController._run_adb("-s", serial, *args)

        if result.returncode == 0:
            return result

        print(
            f"[ADB] comando fallo index={index} "
            f"serial={serial}: {result.stderr.strip()}"
        )

        ADBController.invalidate_serial(index)
        serial = ADBController.resolve_serial(index, force=True)

        return ADBController._run_adb("-s", serial, *args)

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

    # ==================================================================
    # Radios: bluetooth / wifi / datos móviles / modo avión
    # ==================================================================
    @staticmethod
    def set_bluetooth(index: int, enable: bool) -> str:
        """
        Activa/desactiva Bluetooth escribiendo el setting global directo,
        igual que hace la app de Ajustes al tocar el switch en la UI.

        NOTA: `svc bluetooth enable/disable` invoca al BluetoothManagerService
        real vía Binder. En LDPlayer (como en la mayoría de emuladores x86)
        no hay HAL de Bluetooth real detrás, así que el servicio crashea al
        inicializar y el proceso se mata a sí mismo — eso es exactamente el
        "call killProcess callstack" que ves en los logs, y en este caso
        SÍ es un fallo real, no ruido: el bluetooth se queda apagado.
        Escribir el setting directo evita ese camino roto y es consistente
        con lo que lee get_bluetooth_status().
        """
        value = "1" if enable else "0"
        return ADBController.shell(index, f"settings put global bluetooth_on {value}")

    @staticmethod
    def get_bluetooth_status(index: int) -> bool:
        output = ADBController.shell(index, "settings get global bluetooth_on")
        return output.strip() == "1"

    @staticmethod
    def set_wifi(index: int, enable: bool) -> str:
        """
        Mismo motivo que set_bluetooth: `svc wifi enable/disable` puede
        fallar en emuladores sin radio real. Se prueba primero el setting
        directo (mismo patrón que bluetooth); si tu build de LDPlayer sí
        tiene stack de wifi funcional via svc, podés revertir este método
        a la versión anterior sin problema.
        """
        value = "1" if enable else "0"
        return ADBController.shell(index, f"settings put global wifi_on {value}")

    @staticmethod
    def get_wifi_status(index: int) -> bool:
        output = ADBController.shell(index, "settings get global wifi_on")
        return output.strip() == "1"
        
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
        result = ADBController._run_adb_on_device(index, "install", "-r", apk_path)
        return result.stdout or result.stderr

    @staticmethod
    def uninstall_app(index: int, package: str) -> str:
        result = ADBController._run_adb_on_device(index, "uninstall", package)
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
        result = ADBController.shell(index, "reboot")
        # El serial casi siempre cambia (o desaparece temporalmente) tras un reboot
        ADBController.invalidate_serial(index)
        return result

    @staticmethod
    def get_ip_address(index: int) -> Optional[str]:
        output = ADBController.shell(index, "ip -f inet addr show wlan0")
        match = re.search(r"inet (\d+\.\d+\.\d+\.\d+)", output)
        return match.group(1) if match else None