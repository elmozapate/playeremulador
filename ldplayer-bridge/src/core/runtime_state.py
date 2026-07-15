"""
Estado runtime configurable sin reiniciar el proceso: modo debug (verbose
logging) y TTL del health cache.
"""
import threading

from config import settings


class RuntimeState:
    def __init__(self, initial_debug: bool, initial_health_ttl: float):
        self._lock = threading.Lock()
        self._debug = initial_debug
        self._health_ttl = initial_health_ttl

    @property
    def debug(self) -> bool:
        with self._lock:
            return self._debug

    @debug.setter
    def debug(self, value: bool) -> None:
        with self._lock:
            self._debug = value

    @property
    def health_ttl(self) -> float:
        with self._lock:
            return self._health_ttl

    @health_ttl.setter
    def health_ttl(self, value: float) -> None:
        with self._lock:
            self._health_ttl = value

    def log(self, *args, **kwargs) -> None:
        if self._debug:
            print(*args, **kwargs)

    def log_always(self, *args, **kwargs) -> None:
        print(*args, **kwargs)


runtime_state = RuntimeState(
    initial_debug=settings.DEBUG_LOG,
    initial_health_ttl=settings.HEALTH_CACHE_TTL,
)