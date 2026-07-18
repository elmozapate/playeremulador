"""
Captura de eventos táctiles REALES emitidos por el guest Android vía
`adb shell getevent -lt <device>`. Se usa para GRABAR una secuencia de
gestos (tap/swipe/long_press) tal como el usuario los hace manualmente
sobre la ventana de LDPlayer, y guardarlos como una "task" reproducible
(ver services/macro_service.py).

Clasificación al soltar:
  - movimiento < TAP_MAX_DISTANCE_PX y duración < TAP_MAX_MS      -> tap
  - movimiento < TAP_MAX_DISTANCE_PX y duración >= LONG_PRESS_MIN -> long_press
  - cualquier otro caso                                           -> swipe

NOTA: el escalado de coordenadas crudas -> píxeles de pantalla depende de
los rangos ABS_MT_POSITION_X/Y reportados por `getevent -pl` (ver
ADBController.find_touch_device). En la mayoría de instancias LDPlayer
esos rangos ya coinciden 1:1 con la resolución, pero si notás desfasaje
en los taps grabados, comparar x_range/y_range contra la resolución real.

FIX v1 (buffering, "start/stop devuelve array vacío"):
  - `shell -tt` fuerza PTY: evita que el guest bufferice getevent por
    bloque en vez de por línea.
  - `bufsize=0` en el Popen: evita que Python bufferice el pipe del lado
    de acá.
  - stderr ya no se descarta; se loguea si `getevent` falla de entrada.
  - Contador de líneas raw vs gestos clasificados, para diagnóstico.

FIX v2 (este archivo, "226 líneas raw leídas, 0 gestos clasificados"):
  - El fix v1 solucionó el buffering: los eventos SÍ están llegando.
    El problema pasó a ser de clasificación: la máquina de estados solo
    reconocía BTN_TOUCH DOWN/UP para marcar inicio/fin de un toque. Los
    dispositivos táctiles virtuales de LDPlayer suelen implementar
    multitouch "protocolo B" (tipo Android estándar), donde el fin de
    un toque se señaliza con ABS_MT_TRACKING_ID = -1 (0xffffffff) y NO
    necesariamente emiten BTN_TOUCH UP. Ahora se contempla también esa
    señal como equivalente a BTN_TOUCH DOWN/UP.
  - Se agrega logging de las primeras N líneas RAW completas (no solo
    las no reconocidas) cuando debug está ON, para poder ver el
    protocolo real que manda el dispositivo si esto vuelve a fallar.
  - Se corrige el log de _code_counts, que había quedado mal ubicado
    dentro de start() (corría a los 0.6s con casi nada capturado) — 
    ahora se loguea al final, en stop(), reflejando toda la sesión.
"""
import re
import subprocess
import threading
import time
from collections import Counter
from typing import Callable, Dict, List, Optional

from config import settings
from core.runtime_state import runtime_state

# Colon tolerante a espacio opcional antes: algunos guests alinean la
# columna del device path y dejan un espacio extra antes de ':'.
_LINE_RE = re.compile(r"^\[\s*[\d.]+\]\s*(/dev/input/event\d+)\s*:\s*(\S+)\s+(\S+)\s+(\S+)\s*$")

TAP_MAX_DISTANCE_PX = 12
TAP_MAX_MS = 200
LONG_PRESS_MIN_MS = 500

# Cuánto esperar tras lanzar el subproceso para detectar un fallo
# inmediato (device inválido, "no devices/emulators found", permiso
# denegado) antes de darlo por "arrancó bien".
STARTUP_CHECK_S = 0.6

# Cuántas líneas RAW completas logueamos siempre (con debug ON) para
# poder ver el protocolo real de eventos si hace falta re-diagnosticar.
RAW_LOG_LIMIT = 60

# Valor con el que Android señaliza "se levantó el dedo" en
# ABS_MT_TRACKING_ID bajo multitouch protocolo B.
_MT_TRACKING_ID_UP = 0xFFFFFFFF


class TouchCaptureError(RuntimeError):
    """El subproceso `adb shell getevent` no arrancó o murió inesperadamente."""


class TouchRecorder:
    def __init__(self, serial: str, device: str,
                 x_range: Optional[tuple], y_range: Optional[tuple],
                 screen_w: int, screen_h: int,
                 on_gesture: Optional[Callable[[Dict], None]] = None):
        self.serial = serial
        self.device = device
        self.x_range = x_range
        self.y_range = y_range
        self.screen_w = screen_w
        self.screen_h = screen_h
        self.on_gesture = on_gesture

        self._proc: Optional[subprocess.Popen] = None
        self._thread: Optional[threading.Thread] = None
        self._stderr_thread: Optional[threading.Thread] = None
        self._running = False
        self.gestures: List[Dict] = []

        self._cur_x: Optional[int] = None
        self._cur_y: Optional[int] = None
        self._down_at: Optional[float] = None
        self._points: List[Dict] = []

        # Estado para multitouch protocolo B (ABS_MT_TRACKING_ID).
        self._lift_pending = False

        # Diagnóstico.
        self._raw_line_count = 0
        self._unmatched_logged = 0
        self._raw_logged = 0
        self._started_at: Optional[float] = None
        self._code_counts: Counter = Counter()

    def _scale(self, raw_x, raw_y) -> Optional[Dict]:
        if raw_x is None or raw_y is None:
            return None
        x, y = raw_x, raw_y
        if self.x_range and self.x_range[1] != self.x_range[0]:
            x = round((raw_x - self.x_range[0]) / (self.x_range[1] - self.x_range[0]) * self.screen_w)
        if self.y_range and self.y_range[1] != self.y_range[0]:
            y = round((raw_y - self.y_range[0]) / (self.y_range[1] - self.y_range[0]) * self.screen_h)
        return {"x": max(0, min(self.screen_w, x)), "y": max(0, min(self.screen_h, y))}

    def _commit_point(self) -> None:
        scaled = self._scale(self._cur_x, self._cur_y)
        if scaled:
            self._points.append({**scaled, "t": time.time()})

    def _finish_gesture(self) -> None:
        if not self._points or self._down_at is None:
            self._reset_touch()
            return
        first, last = self._points[0], self._points[-1]
        duration_ms = int((last["t"] - self._down_at) * 1000)
        distance = ((last["x"] - first["x"]) ** 2 + (last["y"] - first["y"]) ** 2) ** 0.5

        if distance < TAP_MAX_DISTANCE_PX and duration_ms < TAP_MAX_MS:
            gesture = {"type": "tap", "x": first["x"], "y": first["y"]}
        elif distance < TAP_MAX_DISTANCE_PX and duration_ms >= LONG_PRESS_MIN_MS:
            gesture = {"type": "long_press", "x": first["x"], "y": first["y"], "duration_ms": duration_ms}
        else:
            gesture = {
                "type": "swipe", "x1": first["x"], "y1": first["y"],
                "x2": last["x"], "y2": last["y"], "duration_ms": max(duration_ms, 50),
            }

        prev_end = self.gestures[-1].get("_end_ts") if self.gestures else self._down_at
        gesture["delay_before_ms"] = max(0, int((self._down_at - prev_end) * 1000))
        gesture["_end_ts"] = last["t"]
        self.gestures.append(gesture)
        if self.on_gesture:
            try:
                self.on_gesture({k: v for k, v in gesture.items() if not k.startswith("_")})
            except Exception:
                pass
        self._reset_touch()

    def _reset_touch(self) -> None:
        self._down_at = None
        self._points = []
        self._lift_pending = False

    def _start_touch_if_needed(self) -> None:
        if self._down_at is None:
            self._down_at = time.time()
            self._points = []
        self._lift_pending = False

    def _read_stderr(self) -> None:
        assert self._proc and self._proc.stderr
        for raw_line in self._proc.stderr:
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if line:
                runtime_state.log_always(
                    f"[TouchCapture] stderr device={self.device} serial={self.serial}: {line}"
                )

    def _read_loop(self) -> None:
        assert self._proc and self._proc.stdout
        for raw_line in self._proc.stdout:
            if not self._running:
                break
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if not line:
                continue
            self._raw_line_count += 1

            # Log de las primeras N líneas COMPLETAS (matcheen o no), solo
            # con debug ON, para poder ver el protocolo real si hace falta.
            if self._raw_logged < RAW_LOG_LIMIT:
                self._raw_logged += 1
                runtime_state.log(f"[TouchCapture] raw#{self._raw_logged}: {line!r}")

            m = _LINE_RE.match(line)
            if not m:
                if self._unmatched_logged < 3:
                    self._unmatched_logged += 1
                    runtime_state.log_always(f"[TouchCapture] línea no reconocida: {line!r}")
                continue
            _dev, ev_type, ev_code, ev_value = m.groups()
            self._code_counts[(ev_type, ev_code)] += 1

            if ev_type == "EV_ABS" and ev_code == "ABS_MT_POSITION_X":
                self._cur_x = int(ev_value, 16)
            elif ev_type == "EV_ABS" and ev_code == "ABS_MT_POSITION_Y":
                self._cur_y = int(ev_value, 16)
            elif ev_type == "EV_ABS" and ev_code == "ABS_MT_TRACKING_ID":
                # Multitouch protocolo B: nuevo ID = dedo baja; 0xffffffff = dedo sube.
                try:
                    track_id = int(ev_value, 16)
                except ValueError:
                    track_id = None
                if track_id == _MT_TRACKING_ID_UP:
                    self._lift_pending = True
                elif track_id is not None:
                    self._start_touch_if_needed()
            elif ev_type == "EV_KEY" and ev_code == "BTN_TOUCH":
                # Protocolo A / legacy: algunos dispositivos SÍ emiten esto,
                # en paralelo o en vez de ABS_MT_TRACKING_ID.
                if ev_value == "DOWN":
                    self._start_touch_if_needed()
                elif ev_value == "UP":
                    self._finish_gesture()
            elif ev_type == "EV_SYN" and ev_code == "SYN_REPORT" and self._down_at is not None:
                self._commit_point()
                if self._lift_pending:
                    self._finish_gesture()

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._raw_line_count = 0
        self._unmatched_logged = 0
        self._raw_logged = 0
        self._code_counts = Counter()
        self._proc = subprocess.Popen(
            [settings.ADB_PATH, "-s", self.serial, "shell", "-tt", "getevent", "-lt", self.device],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()
        self._stderr_thread = threading.Thread(target=self._read_stderr, daemon=True)
        self._stderr_thread.start()

        time.sleep(STARTUP_CHECK_S)
        if self._proc.poll() is not None:
            self._running = False
            returncode = self._proc.returncode
            self._proc = None
            raise TouchCaptureError(
                f"getevent terminó inmediatamente (returncode={returncode}) "
                f"para device={self.device} serial={self.serial}. "
                f"Revisar el log de stderr justo arriba de este mensaje."
            )
        self._started_at = time.time()
        runtime_state.log_always(
            f"[TouchCapture] getevent corriendo OK (pid={self._proc.pid}) "
            f"device={self.device} serial={self.serial}"
        )

    def stop(self) -> List[Dict]:
        self._running = False
        if self._proc:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self._proc.kill()
            self._proc = None
        runtime_state.log_always(
            f"[TouchCapture] captura detenida device={self.device}: "
            f"{self._raw_line_count} líneas raw leídas, "
            f"{len(self.gestures)} gestos clasificados, "
            f"eventos vistos: {dict(self._code_counts.most_common(10))}"
        )
        return [{k: v for k, v in g.items() if not k.startswith("_")} for g in self.gestures]

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def elapsed_ms(self) -> Optional[int]:
        if self._started_at is None:
            return None
        return int((time.time() - self._started_at) * 1000)

    def peek_gestures(self) -> List[Dict]:
        """Copia de los gestos capturados hasta ahora, SIN detener la
        captura. self.gestures solo crece por append() desde el thread de
        lectura, así que un slice acá es seguro (protegido por el GIL)."""
        return [{k: v for k, v in g.items() if not k.startswith("_")} for g in self.gestures]

    def stats(self) -> Dict:
        """Contadores de diagnóstico + estado, para health-check en vivo
        sin afectar la captura en curso."""
        return {
            "running": self._running,
            "raw_line_count": self._raw_line_count,
            "gestures_count": len(self.gestures),
            "unmatched_logged": self._unmatched_logged,
            "code_counts": dict(self._code_counts.most_common(10)),
        }