import os
import subprocess
import json
import time
from typing import List, Dict, Optional

from config import settings


class LDConsoleError(RuntimeError):
    """Error al ejecutar un comando de ldconsole.exe."""


class LDConsoleError(RuntimeError):
    """Error al ejecutar un comando de ldconsole.exe."""
LDCONSOLE_TIMEOUT_S = 30
class LDConsole:
    @staticmethod
    def _binary() -> str:
        path = settings.LDPLAYER_PATH
        if not os.path.exists(path):
            raise LDConsoleError(f"No se encontró ldconsole.exe en: {path}")
        return path
    @staticmethod
    def _run(args: List[str], check: bool = True, timeout: float = LDCONSOLE_TIMEOUT_S) -> subprocess.CompletedProcess:
        cmd = [LDConsole._binary()] + args
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, encoding="utf-8", timeout=timeout,
            )
        except subprocess.TimeoutExpired as e:
            raise LDConsoleError(
                f"Comando {cmd} no respondió en {timeout}s (¿ldconsole.exe colgado?)"
            ) from e
        if check and result.returncode != 0:
            raise LDConsoleError(f"Comando falló {cmd}: {result.stderr.strip()}")
        return result

    @staticmethod
    def _selector(base_args: List[str], index: Optional[int], name: Optional[str]) -> List[str]:
        if index is not None:
            return base_args + ["--index", str(index)]
        if name:
            return base_args + ["--name", name]
        raise ValueError("Se requiere 'index' o 'name'")

    # ---- Listado ------------------------------------------------------
    @staticmethod
    def list_instances() -> List[Dict]:
        """Ejecuta `list2` y devuelve instancias parseadas."""
        result = LDConsole._run(["list2"])
        return LDConsole._parse_list2(result.stdout)

    @staticmethod
    def _parse_list2(output: str) -> List[Dict]:
        """
        Formato de ldconsole list2:
        index,title,window_handle,bound_handle,android_started,pid,vbox_pid
        """
        instances = []
        for line in output.strip().splitlines():
            if not line.strip():
                continue
            parts = line.split(",")
            if len(parts) < 7:
                continue
            instances.append({
                "index": int(parts[0]),
                "name": parts[1],
                "window_handle": parts[2],
                "bound_handle": parts[3],
                "android_started": parts[4] == "1",
                "pid": int(parts[5]) if parts[5].isdigit() else None,
                "vbox_pid": int(parts[6]) if parts[6].isdigit() else None,
            })
        return instances

    # ---- Ciclo de vida --------------------------------------------------
    @staticmethod
    def launch(index: Optional[int] = None, name: Optional[str] = None) -> None:
        LDConsole._run(LDConsole._selector(["launch"], index, name))

    @staticmethod
    def quit(index: Optional[int] = None, name: Optional[str] = None) -> None:
        LDConsole._run(LDConsole._selector(["quit"], index, name))

    @staticmethod
    def quitall() -> None:
        LDConsole._run(["quitall"])

    @staticmethod
    def reboot(index: Optional[int] = None, name: Optional[str] = None) -> None:
        LDConsole._run(LDConsole._selector(["reboot"], index, name))

 # ---- Configuración --------------------------------------------------
    @staticmethod
    def modify(index: int, cpu: Optional[int] = None, memory: Optional[int] = None,
               resolution: Optional[str] = None, root: Optional[bool] = None) -> None:
        args = ["modify", "--index", str(index)]
        if resolution:
            args += ["--resolution", resolution]  # "width,height,dpi"
        if cpu is not None:
            args += ["--cpu", str(cpu)]
        if memory is not None:
            args += ["--memory", str(memory)]
        if root is not None:
            args += ["--root", "1" if root else "0"]
        if len(args) == 3:
            raise ValueError("modify requiere al menos un parámetro (cpu, memory, resolution o root)")
        LDConsole._run(args)

    @staticmethod
    def _config_path(index: int) -> str:
        """
        Devuelve el archivo de configuración de la instancia LDPlayer.
        """

        ldconsole_path = LDConsole._binary()
        ldplayer_dir = os.path.dirname(ldconsole_path)

        config_path = os.path.join(
            ldplayer_dir,
            "vms",
            "config",
            f"leidian{index}.config",
        )

        if not os.path.exists(config_path):
            raise LDConsoleError(
                f"No se encontró configuración para index={index}: "
                f"{config_path}"
            )

        return config_path

    @staticmethod
    def set_dev_mode(
        index: int,
        root: bool = True,
        adb_debug: int = 2,
    ) -> None:
        """
        Configura ROOT y ADB Debug de LDPlayer.

        adb_debug:
            0 = cerrado
            1 = conexión local
            2 = conexión remota
        """

        if adb_debug not in (0, 1, 2):
            raise ValueError(
                "adb_debug debe ser 0 (off), 1 (local) o 2 (remote)"
            )

        config_path = LDConsole._config_path(index)

        with open(config_path, "r", encoding="utf-8-sig") as file:
            config = json.load(file)

        config["basicSettings.rootMode"] = 2 if root else 0
        config["basicSettings.adbDebug"] = adb_debug

        temp_path = f"{config_path}.tmp"

        with open(temp_path, "w", encoding="utf-8") as file:
            json.dump(
                config,
                file,
                ensure_ascii=False,
                separators=(",", ":"),
            )

        os.replace(temp_path, config_path)

        print(
            f"[LDConsole] index={index} "
            f"root={root} adb_debug={adb_debug}"
        )

    @staticmethod
    def enable_dev_mode(index: int) -> None:
        """
        Activa ROOT + ADB local.
        La instancia debe reiniciarse para aplicar los cambios.
        """

        LDConsole.set_dev_mode(
            index=index,
            root=True,
            adb_debug=2,
        )

    @staticmethod
    def disable_dev_mode(index: int) -> None:
        """
        Desactiva ROOT y ADB.
        """

        LDConsole.set_dev_mode(
            index=index,
            root=False,
            adb_debug=0,
        )

    @staticmethod
    def restart_with_dev_mode(
        index: int,
        wait_after_quit: float = 2.0,
    ) -> None:
        """
        Apaga la instancia, activa ROOT + ADB local y vuelve a lanzarla.
        """

        instances = LDConsole.list_instances()

        instance = next(
            (
                item
                for item in instances
                if item["index"] == index
            ),
            None,
        )

        if instance is None:
            raise LDConsoleError(
                f"No existe instancia LDPlayer index={index}"
            )

        if instance["pid"] or instance["vbox_pid"]:
            print(
                f"[LDConsole] index={index} -> apagando para modificar config"
            )

            LDConsole.quit(index=index)
            time.sleep(wait_after_quit)

        LDConsole.enable_dev_mode(index)

        print(
            f"[LDConsole] index={index} -> lanzando con ROOT + ADB local"
        )

        LDConsole.launch(index=index)

    # ---- Apps -------------------------------------------------------
    @staticmethod
    def install_app(index: int, apk_path: str) -> None:
        LDConsole._run(["installapp", "--index", str(index), "--filename", apk_path])

    @staticmethod
    def run_app(index: int, package_name: str) -> None:
        LDConsole._run(["runapp", "--index", str(index), "--packagename", package_name])

    @staticmethod
    def clone(source_index: Optional[int] = None, source_name: Optional[str] = None,
              new_name: Optional[str] = None) -> None:
        """
        Clona una instancia existente a un nuevo nombre.
        Usa el comando 'clone' de LDPlayer (versión 9+).
        """
        if not new_name:
            raise ValueError("Se requiere 'new_name' para clonar")

        if source_index is not None:
            from_arg = str(source_index)
        elif source_name:
            from_arg = source_name
        else:
            raise ValueError("Se requiere 'source_index' o 'source_name' para clonar")

        # Comando: clone --from <origen> --name <nuevo_nombre>
        LDConsole._run(["clone", "--from", from_arg, "--name", new_name])

    @staticmethod
    def kill_app(index: int, package_name: str) -> None:
        """Cierra una app usando el comando killapp de ldconsole."""
        LDConsole._run(["killapp", "--index", str(index), "--packagename", package_name])
