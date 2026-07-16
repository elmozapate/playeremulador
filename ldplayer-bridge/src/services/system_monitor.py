"""
system_monitor.py
Monitor liviano de CPU/RAM que corre en un thread daemon aparte.
No hace nada hasta que se llama start(). Costo real cuando está inactivo: ~0.
"""

import threading
import time
from collections import deque
from typing import Optional

import psutil


class SystemMonitor:
    def __init__(self, interval: float = 2.0, history_size: int = 60):
        """
        interval: segundos entre muestras (2.0 = liviano, casi 0% overhead real)
        history_size: cuántas muestras guarda en memoria (deque circular, no crece)
        """
        self.interval = interval
        self.history = deque(maxlen=history_size)
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._active = False

    def _loop(self):
        # la primera llamada a cpu_percent siempre da 0.0, se descarta
        psutil.cpu_percent(interval=None)
        while not self._stop_event.is_set():
            cpu = psutil.cpu_percent(interval=None)
            mem = psutil.virtual_memory()
            sample = {
                "ts": time.time(),
                "cpu_percent": cpu,
                "ram_percent": mem.percent,
                "ram_used_mb": round(mem.used / (1024 * 1024), 1),
                "ram_total_mb": round(mem.total / (1024 * 1024), 1),
            }
            with self._lock:
                self.history.append(sample)
            self._stop_event.wait(self.interval)

    def start(self) -> bool:
        with self._lock:
            if self._active:
                return False
            self._stop_event.clear()
            self._thread = threading.Thread(target=self._loop, daemon=True)
            self._thread.start()
            self._active = True
            return True

    def stop(self) -> bool:
        with self._lock:
            if not self._active:
                return False
            self._stop_event.set()
            self._active = False
            return True

    def status(self) -> dict:
        with self._lock:
            return {
                "active": self._active,
                "interval": self.interval,
                "samples": len(self.history),
            }

    def current(self) -> Optional[dict]:
        with self._lock:
            return self.history[-1] if self.history else None

    def get_history(self) -> list:
        with self._lock:
            return list(self.history)

    def set_interval(self, seconds: float):
        with self._lock:
            self.interval = max(0.5, seconds)


# instancia única (singleton) para importar directo desde el router u otros módulos
monitor = SystemMonitor()