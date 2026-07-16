"""
Estado runtime configurable sin reiniciar el proceso: modo debug (verbose
logging), TTL del health cache y el intervalo del monitor de background.
Persistencia: cualquier cambio hecho en caliente (vía POST /api/v1/debug/*)
se guarda en DATA_DIR/config/runtime.json (ver core.data_store) para que
sobreviva a un reinicio del proceso. Al arrancar, si existe ese archivo,
sus valores pisan los defaults de settings.
Logging: log() solo sale por stdout si debug está activo; log_always()
sale siempre por stdout (esto es lo que Node captura del proceso Python
y reenvía por consola/SSE). AMBOS se guardan siempre en
DATA_DIR/logs/service.log, sin importar el modo debug, para tener
histórico completo de lo que pasó.
"""
import threading
import time
from config import settings
from core.data_store import data_store

class RuntimeState:
    def __init__(self, initial_debug: bool, initial_health_ttl: float, initial_monitor_interval: float):
        self._lock = threading.Lock()
        persisted = data_store.read_runtime_config() or {}
        self._debug = persisted.get("debug", initial_debug)
        self._health_ttl = persisted.get("health_cache_ttl", initial_health_ttl)
        self._monitor_interval = persisted.get("monitor_interval", initial_monitor_interval)
        # Modo reposo – se persiste junto con el resto de la config
        self._sleep_mode = persisted.get("sleep_mode", False)

    @property
    def debug(self) -> bool:
        with self._lock:
            return self._debug

    @debug.setter
    def debug(self, value: bool) -> None:
        with self._lock:
            self._debug = value
        self._persist_config()

    @property
    def health_ttl(self) -> float:
        with self._lock:
            return self._health_ttl

    @health_ttl.setter
    def health_ttl(self, value: float) -> None:
        with self._lock:
            self._health_ttl = value
        self._persist_config()

    @property
    def monitor_interval(self) -> float:
        with self._lock:
            return self._monitor_interval

    @monitor_interval.setter
    def monitor_interval(self, value: float) -> None:
        with self._lock:
            self._monitor_interval = value
        self._persist_config()

    # ---------- NUEVO: modo reposo ----------
    @property
    def sleep_mode(self) -> bool:
        with self._lock:
            return self._sleep_mode

    @sleep_mode.setter
    def sleep_mode(self, value: bool) -> None:
        with self._lock:
            self._sleep_mode = value
        self._persist_config()
    # ----------------------------------------

    def _persist_config(self) -> None:
        with self._lock:
            data = {
                "debug": self._debug,
                "health_cache_ttl": self._health_ttl,
                "monitor_interval": self._monitor_interval,
                "sleep_mode": self._sleep_mode,   # incluimos el nuevo campo
            }
        data_store.write_runtime_config(data)

    @staticmethod
    def _timestamp() -> str:
        return time.strftime("%Y-%m-%d %H:%M:%S")

    def log(self, *args, **kwargs) -> None:
        data_store.append_log(f"[{self._timestamp()}] {' '.join(str(a) for a in args)}")
        if self._debug:
            print(*args, **kwargs)

    def log_always(self, *args, **kwargs) -> None:
        data_store.append_log(f"[{self._timestamp()}] {' '.join(str(a) for a in args)}")
        print(*args, **kwargs)


runtime_state = RuntimeState(
    initial_debug=settings.DEBUG_LOG,
    initial_health_ttl=settings.HEALTH_CACHE_TTL,
    initial_monitor_interval=settings.MONITOR_INTERVAL,
)