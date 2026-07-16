
"""
Registro persistente POR INSTANCIA: health, apks revisadas/instaladas,
permisos confirmados, últimos eventos (reboot/launch/quit), próximo
check programado, tareas, etc.

Un archivo por instancia en DATA_DIR/instances/<index>.json. A
diferencia de health/<index>.json (que es solo un cache de health con
TTL, se pisa entero en cada refresh) y status/all.json (snapshot
efímero del monitor), este archivo es un REGISTRO acumulativo: se lee,
se modifica parcialmente, y se vuelve a escribir completo.

Lo leen y ESCRIBEN los dos lados:
  - Python (este módulo) registra lo que se ejecuta físicamente sobre
    la instancia: health, apks instaladas, permisos otorgados/revocados,
    reboot/launch/quit, y el próximo check programado del monitor.
  - Node (services/instanceRecordStore.js) registra lo que orquesta:
    los pasos/tareas del pipeline de setup (deviceSetupPipeline.js).

Para que no se pisen si escriben casi al mismo tiempo, cada
actualización hace lock -> leer -> modificar -> escribir -> unlock,
con un lockfile simple (<archivo>.json.lock) creado de forma exclusiva
(O_CREAT|O_EXCL, atómico también en Windows). El equivalente en Node
usa el MISMO nombre de archivo y el mismo protocolo, así que ambos
procesos se coordinan sin necesidad de compartir lenguaje ni proceso.
"""
import json
import os
import random
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from config import settings

MAX_EVENTS = 100
MAX_TASKS = 100
LOCK_TIMEOUT_S = 5.0
LOCK_STALE_S = 10.0
LOCK_RETRY_MIN_MS = 30
LOCK_RETRY_MAX_MS = 120


class InstanceRecordStore:
    def __init__(self, base_dir: str, owner: str = "python"):
        self.dir = os.path.join(base_dir, "instances")
        self.owner = owner
        os.makedirs(self.dir, exist_ok=True)

    def _path(self, index: int) -> str:
        return os.path.join(self.dir, f"{index}.json")

    def _lock_path(self, index: int) -> str:
        return f"{self._path(index)}.lock"

    # ------------------------------------------------------------------
    # Lock cross-proceso / cross-lenguaje (archivo .lock exclusivo)
    # ------------------------------------------------------------------
    def _acquire_lock(self, index: int) -> None:
        lock_path = self._lock_path(index)
        deadline = time.time() + LOCK_TIMEOUT_S
        while True:
            try:
                fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                with os.fdopen(fd, "w") as f:
                    f.write(f"{self.owner}:{os.getpid()}:{time.time()}")
                return
            except FileExistsError:
                age = None
                try:
                    age = time.time() - os.path.getmtime(lock_path)
                except OSError:
                    pass
                if age is not None and age > LOCK_STALE_S:
                    # lock huérfano: el que lo tomó se cayó antes de soltarlo
                    try:
                        os.remove(lock_path)
                    except OSError:
                        pass
                    continue
                if time.time() > deadline:
                    raise TimeoutError(
                        f"No se pudo tomar el lock de instances/{index}.json "
                        f"en {LOCK_TIMEOUT_S}s (¿el otro proceso quedó trabado?)"
                    )
                time.sleep(random.uniform(LOCK_RETRY_MIN_MS, LOCK_RETRY_MAX_MS) / 1000)

    def _release_lock(self, index: int) -> None:
        try:
            os.remove(self._lock_path(index))
        except OSError:
            pass

    # ------------------------------------------------------------------
    # Lectura / escritura atómica del registro
    # ------------------------------------------------------------------
    def _read_raw(self, index: int) -> Dict[str, Any]:
        path = self._path(index)
        if not os.path.exists(path):
            return self._blank(index)
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, dict) else self._blank(index)
        except (json.JSONDecodeError, OSError):
            return self._blank(index)

    def _write_raw(self, index: int, data: Dict[str, Any]) -> None:
        path = self._path(index)
        tmp_path = f"{path}.tmp-{os.getpid()}-{time.time()}"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp_path, path)

    @staticmethod
    def _blank(index: int) -> Dict[str, Any]:
        return {
            "index": index,
            "name": None,
            "updated_at": None,
            "updated_by": None,
            "health": {},
            "schedule": {
                "next_check_at": None,
                "last_reboot_at": None,
                "last_launch_at": None,
                "last_quit_at": None,
            },
            "apks": {},
            "permissions": {},
            "tasks": [],
            "events": [],
        }

    def get(self, index: int) -> Dict[str, Any]:
        return self._read_raw(index)

    def update(self, index: int, updater: Callable[[Dict[str, Any]], None]) -> Dict[str, Any]:
        """Lock -> leer -> updater(record) muta el dict in-place -> escribir -> unlock."""
        self._acquire_lock(index)
        try:
            record = self._read_raw(index)
            updater(record)
            record["updated_at"] = time.time()
            record["updated_by"] = self.owner
            self._write_raw(index, record)
            return record
        finally:
            self._release_lock(index)

    def delete(self, index: int) -> None:
        path = self._path(index)
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass

    # ------------------------------------------------------------------
    # Helpers de alto nivel (todos pasan por update() -> con lock)
    # ------------------------------------------------------------------
    def record_health(self, index: int, name: Optional[str], health: Dict[str, Any]) -> None:
        def _fn(r):
            if name:
                r["name"] = name
            r["health"] = {
                "android_started": health.get("android_started"),
                "pid": health.get("pid"),
                "battery": health.get("battery"),
                "battery_error": health.get("battery_error"),
                "checked_at": time.time(),
            }
        self.update(index, _fn)

    def schedule_next_check(self, index: int, seconds_from_now: float) -> None:
        def _fn(r):
            r["schedule"]["next_check_at"] = time.time() + seconds_from_now
        self.update(index, _fn)

    def record_launch(self, index: int) -> None:
        def _fn(r):
            r["schedule"]["last_launch_at"] = time.time()
        self.update(index, _fn)
        self.add_event(index, "launch", "Instancia lanzada")

    def record_reboot(self, index: int) -> None:
        def _fn(r):
            r["schedule"]["last_reboot_at"] = time.time()
        self.update(index, _fn)
        self.add_event(index, "reboot", "Instancia reiniciada")

    def record_quit(self, index: int) -> None:
        def _fn(r):
            r["schedule"]["last_quit_at"] = time.time()
        self.update(index, _fn)
        self.add_event(index, "quit", "Instancia cerrada")

    def record_apk(self, index: int, apk_id: str, status: str,
                    apk_path: Optional[str] = None) -> None:
        """status: 'installed' | 'uninstalled' | 'force_stopped' | 'data_cleared' | 'failed'"""
        def _fn(r):
            entry = r["apks"].get(apk_id, {})
            entry["status"] = status
            if apk_path:
                entry["apk_path"] = apk_path
            entry[f"{status}_at"] = time.time()
            r["apks"][apk_id] = entry
        self.update(index, _fn)

    def record_permission(self, index: int, package_name: str, permission: str, granted: bool) -> None:
        def _fn(r):
            pkg = r["permissions"].setdefault(package_name, {})
            pkg[permission] = {"granted": granted, "confirmed_at": time.time()}
        self.update(index, _fn)

    def add_event(self, index: int, event_type: str, message: str, extra: Optional[dict] = None) -> None:
        def _fn(r):
            events: List[dict] = r.setdefault("events", [])
            events.append({
                "ts": time.time(),
                "type": event_type,
                "source": self.owner,
                "message": message,
                "extra": extra or {},
            })
            if len(events) > MAX_EVENTS:
                del events[: len(events) - MAX_EVENTS]
        self.update(index, _fn)

    def add_task(self, index: int, task_type: str, detail: Optional[dict] = None) -> str:
        task_id = uuid.uuid4().hex[:12]

        def _fn(r):
            tasks: List[dict] = r.setdefault("tasks", [])
            tasks.append({
                "id": task_id,
                "type": task_type,
                "status": "pending",
                "created_at": time.time(),
                "updated_at": time.time(),
                "detail": detail or {},
            })
            if len(tasks) > MAX_TASKS:
                del tasks[: len(tasks) - MAX_TASKS]
        self.update(index, _fn)
        return task_id

    def update_task(self, index: int, task_id: str, status: str, detail: Optional[dict] = None) -> None:
        def _fn(r):
            for task in r.get("tasks", []):
                if task["id"] == task_id:
                    task["status"] = status
                    task["updated_at"] = time.time()
                    if detail:
                        task["detail"] = {**task.get("detail", {}), **detail}
                    break
        self.update(index, _fn)

    def prune(self, active_indices: set) -> None:
        """Borra registros (y locks sueltos) de índices que ya no existen."""
        try:
            files = os.listdir(self.dir)
        except OSError:
            return
        for name in files:
            stem = name[: -len(".json")] if name.endswith(".json") else (
                name[: -len(".json.lock")] if name.endswith(".json.lock") else None
            )
            if stem is None or not stem.isdigit():
                continue
            if int(stem) not in active_indices:
                try:
                    os.remove(os.path.join(self.dir, name))
                except OSError:
                    pass


instance_record_store = InstanceRecordStore(settings.DATA_DIR, owner="python")