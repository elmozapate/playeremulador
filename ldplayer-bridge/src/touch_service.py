"""
Servicio de captura de toques reales (Fase 2). Mantiene un TouchRecorder
activo por índice de instancia y reenvía cada gesto detectado por el WS
bridge en tiempo real (type "touch-event"), además de devolver el buffer
completo cuando se hace stop().

Éste es el eslabón que faltaba: core/touch_capture.py ya tenía la clase
TouchRecorder lista, pero nadie la conectaba con ADBController.resolve_serial /
find_touch_device / get_screen_resolution ni exponía start()/stop() por
índice. Sin esto, POST /{index}/touch/start y /touch/stop en Node siempre
devuelven 404/502 porque el endpoint Python no existe.
"""
import asyncio
from typing import Dict, List

from core.adb import ADBController
from core.runtime_state import runtime_state
from core.touch_capture import TouchRecorder


class TouchServiceError(RuntimeError):
    """Error del servicio de captura de toques (estado inválido, no fallo de transporte)."""


class TouchService:
    def __init__(self):
        self._recorders: Dict[int, TouchRecorder] = {}
        self._lock = asyncio.Lock()

    def _on_gesture(self, index: int, gesture: dict) -> None:
        # Reenvío best-effort por WS; nunca debe romper la captura en curso.
        try:
            from services.ws_bridge import bridge  # import perezoso: evita ciclo con services/__init__
            bridge.broadcast_threadsafe(
                "instance-event",
                {"index": index, "event": "touch-event", "gesture": gesture},
            )
        except Exception as e:
            runtime_state.log(f"[Touch] index={index} no se pudo emitir gesto por WS: {e}")

    async def start(self, index: int) -> dict:
        async with self._lock:
            if index in self._recorders:
                raise TouchServiceError(
                    f"Ya hay captura de toques activa para index={index}"
                )

            def _setup():
                serial = ADBController.resolve_serial(index)
                touch_info = ADBController.find_touch_device(index)
                if not touch_info:
                    raise TouchServiceError(
                        f"No se encontró dispositivo de touch "
                        f"(ABS_MT_POSITION_X/Y) para index={index}"
                    )
                resolution = ADBController.get_screen_resolution(index)
                return serial, touch_info, resolution

            serial, touch_info, resolution = await asyncio.to_thread(_setup)

            recorder = TouchRecorder(
                serial=serial,
                device=touch_info["device"],
                x_range=touch_info["x_range"],
                y_range=touch_info["y_range"],
                screen_w=resolution["width"],
                screen_h=resolution["height"],
                on_gesture=lambda gesture: self._on_gesture(index, gesture),
            )
            await asyncio.to_thread(recorder.start)
            self._recorders[index] = recorder
            runtime_state.log_always(
                f"[Touch] index={index} captura iniciada "
                f"(device={touch_info['device']}, serial={serial})"
            )
            return {
                "index": index,
                "listening": True,
                "device": touch_info["device"],
                "serial": serial,
            }

    async def stop(self, index: int) -> dict:
        async with self._lock:
            recorder = self._recorders.pop(index, None)
            if recorder is None:
                raise TouchServiceError(
                    f"No hay captura de toques activa para index={index}"
                )

            gestures: List[dict] = await asyncio.to_thread(recorder.stop)
            runtime_state.log_always(
                f"[Touch] index={index} captura detenida "
                f"({len(gestures)} gestos capturados)"
            )
            return {
                "index": index,
                "listening": False,
                "gestures": gestures,
                "count": len(gestures),
            }

    def is_listening(self, index: int) -> bool:
        return index in self._recorders

    async def prune(self, active_indices: set) -> None:
        """Detiene captura de índices que ya no existen (instancia borrada
        con captura activa). Llamar desde el mismo ciclo que ADBController.prune()."""
        async with self._lock:
            stale = [idx for idx in self._recorders if idx not in active_indices]
            for idx in stale:
                recorder = self._recorders.pop(idx, None)
                if recorder:
                    await asyncio.to_thread(recorder.stop)
                    runtime_state.log_always(
                        f"[Touch] index={idx} captura detenida por prune (instancia ya no existe)"
                    )


touch_service = TouchService()