"""
Almacenamiento compartido en disco (filesystem) para status, health, logs
y config runtime. Reemplaza el cache en memoria: Python escribe acá y
Node lee directo del mismo archivo (ambos proyectos están en la misma
raíz), sin pasar por HTTP para esos datos "de fondo". La comunicación
HTTP entre los dos sigue existiendo para consultas puntuales en caliente
(acciones sobre una instancia, cosas que todavía no están en el
snapshot, etc.) — eso no cambia acá.

Estructura bajo DATA_DIR:
    status/all.json          -> snapshot completo de todas las instancias
    health/<index>.json      -> health cacheado por instancia + timestamp
    config/runtime.json      -> debug / health_ttl / monitor_interval
                                 persistidos (sobreviven a un reinicio)
    logs/service.log         -> log de texto plano (append). SIEMPRE se
                                 escribe acá; que además salga por stdout
                                 depende de runtime_state.debug (ver
                                 core.runtime_state).

Todas las escrituras de JSON son atómicas (archivo temporal + os.replace)
para que Node nunca lea un archivo a medio escribir.
"""
import json
import os
import threading
import time
from typing import Any, Optional


class DataStore:
    def __init__(self, base_dir: str):
        self.base_dir = base_dir
        self.status_dir = os.path.join(base_dir, "status")
        self.health_dir = os.path.join(base_dir, "health")
        self.config_dir = os.path.join(base_dir, "config")
        self.logs_dir = os.path.join(base_dir, "logs")
        self._log_lock = threading.Lock()
        for d in (self.status_dir, self.health_dir, self.config_dir, self.logs_dir):
            os.makedirs(d, exist_ok=True)

    # ------------------------------------------------------------------
    # Escritura / lectura atómica genérica
    # ------------------------------------------------------------------
    @staticmethod
    def _write_json_atomic(path: str, data: Any) -> None:
        tmp_path = f"{path}.tmp-{os.getpid()}-{threading.get_ident()}"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp_path, path)

    @staticmethod
    def _read_json(path: str) -> Optional[Any]:
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            # archivo a medio escribir o corrupto: tratamos como "no hay dato"
            return None

    # ------------------------------------------------------------------
    # Status (snapshot de todas las instancias)
    # ------------------------------------------------------------------
    def write_status_snapshot(self, instances: dict) -> None:
        payload = {"instances": instances, "updated_at": time.time()}
        self._write_json_atomic(os.path.join(self.status_dir, "all.json"), payload)

    def read_status_snapshot(self) -> Optional[dict]:
        return self._read_json(os.path.join(self.status_dir, "all.json"))

    # ------------------------------------------------------------------
    # Health por instancia (con timestamp para que quien lea calcule TTL)
    # ------------------------------------------------------------------
    def write_health(self, index: int, health: dict) -> None:
        payload = {"health": health, "updated_at": time.time()}
        self._write_json_atomic(os.path.join(self.health_dir, f"{index}.json"), payload)

    def read_health(self, index: int) -> Optional[dict]:
        return self._read_json(os.path.join(self.health_dir, f"{index}.json"))

    def delete_health(self, index: int) -> None:
        path = os.path.join(self.health_dir, f"{index}.json")
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass

    def prune_health(self, active_indices: set) -> None:
        """Borra archivos de health de índices que ya no existen (instancias
        clonadas y luego borradas, por ejemplo)."""
        try:
            files = os.listdir(self.health_dir)
        except OSError:
            return
        for name in files:
            if not name.endswith(".json"):
                continue
            stem = name[: -len(".json")]
            if not stem.isdigit() or int(stem) not in active_indices:
                try:
                    os.remove(os.path.join(self.health_dir, name))
                except OSError:
                    pass

    # ------------------------------------------------------------------
    # Config runtime persistida (debug / health_ttl / monitor_interval)
    # ------------------------------------------------------------------
    def read_runtime_config(self) -> Optional[dict]:
        return self._read_json(os.path.join(self.config_dir, "runtime.json"))

    def write_runtime_config(self, data: dict) -> None:
        self._write_json_atomic(os.path.join(self.config_dir, "runtime.json"), data)

    # ------------------------------------------------------------------
    # Log de texto plano (append). La consola es un tema aparte: la
    # decide runtime_state.log()/log_always() según el modo debug.
    # ------------------------------------------------------------------
    def append_log(self, line: str) -> None:
        with self._log_lock:
            try:
                with open(os.path.join(self.logs_dir, "service.log"), "a", encoding="utf-8") as f:
                    f.write(line.rstrip("\n") + "\n")
            except OSError:
                pass


# Import tardío para evitar ciclo config <-> data_store en algunos casos
from config import settings  # noqa: E402

data_store = DataStore(settings.DATA_DIR)
