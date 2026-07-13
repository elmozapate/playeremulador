import os
import subprocess
from typing import List, Dict, Optional

from config import settings


class LDConsoleError(RuntimeError):
    """Error al ejecutar un comando de ldconsole.exe."""


class LDConsole:
    @staticmethod
    def _binary() -> str:
        path = settings.LDPLAYER_PATH
        if not os.path.exists(path):
            raise LDConsoleError(f"No se encontró ldconsole.exe en: {path}")
        return path

    @staticmethod
    def _run(args: List[str], check: bool = True) -> subprocess.CompletedProcess:
        cmd = [LDConsole._binary()] + args
        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
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
               resolution: Optional[str] = None) -> None:
        args = ["modify", "--index", str(index)]
        if resolution:
            args += ["--resolution", resolution]  # "width,height,dpi"
        if cpu is not None:
            args += ["--cpu", str(cpu)]
        if memory is not None:
            args += ["--memory", str(memory)]
        if len(args) == 3:
            raise ValueError("modify requiere al menos un parámetro (cpu, memory o resolution)")
        LDConsole._run(args)

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
