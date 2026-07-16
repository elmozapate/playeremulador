"""
Captura de eventos táctiles REALES emitidos por el guest Android vía
`adb shell getevent -lt <device>`. Se usa para GRABAR una secuencia de
gestos (tap/swipe/long_press) tal como el usuario los hace manualmente
sobre la ventana de LDPlayer, y guardarlos como una "task" reproducible
(ver services/macro_service.py).

Clasificación al soltar (BTN_TOUCH UP):
  - movimiento < TAP_MAX_DISTANCE_PX y duración < TAP_MAX_MS      -> tap
  - movimiento < TAP_MAX_DISTANCE_PX y duración >= LONG_PRESS_MIN -> long_press
  - cualquier otro caso                                           -> swipe

NOTA: el escalado de coordenadas crudas -> píxeles de pantalla depende de
los rangos ABS_MT_POSITION_X/Y reportados por `getevent -pl` (ver
ADBController.find_touch_device). En la mayoría de instancias LDPlayer
esos rangos ya coinciden 1:1 con la resolución, pero si notás desfasaje
en los taps grabados, comparar x_range/y_range contra la resolución real.
"""
import re
import subprocess
import threading
import time
from typing import Callable, Dict, List, Optional

from config import settings

_LINE_RE = re.compile(r"^\[\s*[\d.]+\]\s+(/dev/input/event\d+):\s+(\S+)\s+(\S+)\s+(\S+)$")

TAP_MAX_DISTANCE_PX = 12
TAP_MAX_MS = 200
LONG_PRESS_MIN_MS = 500


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
        self._running = False
        self.gestures: List[Dict] = []

        self._cur_x: Optional[int] = None
        self._cur_y: Optional[int] = None
        self._down_at: Optional[float] = None
        self._points: List[Dict] = []

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

    def _read_loop(self) -> None:
        assert self._proc and self._proc.stdout
        for raw_line in self._proc.stdout:
            if not self._running:
                break
            line = raw_line.decode("utf-8", errors="ignore").strip()
            m = _LINE_RE.match(line)
            if not m:
                continue
            _dev, ev_type, ev_code, ev_value = m.groups()
            if ev_type == "EV_ABS" and ev_code == "ABS_MT_POSITION_X":
                self._cur_x = int(ev_value, 16)
            elif ev_type == "EV_ABS" and ev_code == "ABS_MT_POSITION_Y":
                self._cur_y = int(ev_value, 16)
            elif ev_type == "EV_KEY" and ev_code == "BTN_TOUCH":
                if ev_value == "DOWN":
                    self._down_at = time.time()
                    self._points = []
                elif ev_value == "UP":
                    self._finish_gesture()
            elif ev_type == "EV_SYN" and ev_code == "SYN_REPORT" and self._down_at is not None:
                self._commit_point()

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._proc = subprocess.Popen(
            [settings.ADB_PATH, "-s", self.serial, "shell", "getevent", "-lt", self.device],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()

    def stop(self) -> List[Dict]:
        self._running = False
        if self._proc:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self._proc.kill()
            self._proc = None
        return [{k: v for k, v in g.items() if not k.startswith("_")} for g in self.gestures]