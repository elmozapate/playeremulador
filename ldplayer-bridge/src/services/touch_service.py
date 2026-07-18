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
    
    async def status(self, index: int) -> dict:
        """Estado en vivo de una captura activa, sin detenerla.

        No toma self._lock a propósito: es una lectura pura sobre
        self._recorders y sobre contadores del recorder, y en asyncio
        (single-threaded) un dict.get() no cede el control entre
        corutinas, así que no compite con start()/stop() en curso.
        """
        recorder = self._recorders.get(index)
        if recorder is None:
            raise TouchServiceError(
                f"No hay captura de toques activa para index={index}"
            )
        stats = recorder.stats()
        return {
            "index": index,
            "listening": stats["running"],
            "device": recorder.device,
            "serial": recorder.serial,
            "gestures_count": stats["gestures_count"],
            "raw_line_count": stats["raw_line_count"],
            "elapsed_ms": recorder.elapsed_ms,
        }

    async def list_active(self) -> dict:
        """Lista todas las capturas activas en el proceso (todas las
        instancias), para un panel admin o para recuperar estado tras un
        refresh del front sin tener que golpear cada index a mano."""
        active = []
        for idx, recorder in self._recorders.items():
            stats = recorder.stats()
            active.append({
                "index": idx,
                "device": recorder.device,
                "serial": recorder.serial,
                "gestures_count": stats["gestures_count"],
                "raw_line_count": stats["raw_line_count"],
                "elapsed_ms": recorder.elapsed_ms or 0,
            })
        return {"active": active, "count": len(active)}

    async def cancel(self, index: int) -> dict:
        """Detiene la captura y DESCARTA los gestos (caso 'cancelar
        grabación'). Se expone separado de stop() para que el front tenga
        un endpoint que semánticamente nunca devuelve datos para guardar
        -- evita el bug de UX de reusar stop() y que alguien crea que
        cancelar no persiste nada cuando en realidad sí devuelve la lista.
        """
        async with self._lock:
            recorder = self._recorders.pop(index, None)
            if recorder is None:
                raise TouchServiceError(
                    f"No hay captura de toques activa para index={index}"
                )
            discarded_count = len(recorder.gestures)
            await asyncio.to_thread(recorder.stop)
            runtime_state.log_always(
                f"[Touch] index={index} captura cancelada y descartada "
                f"({discarded_count} gestos descartados)"
            )

            # Import perezoso, mismo motivo que en _on_gesture: evita ciclo
            # con services/__init__. A diferencia de _on_gesture (que corre
            # en el thread de lectura de getevent), cancel() ya está en el
            # event loop de asyncio -- await bridge.broadcast() directo,
            # sin necesidad de broadcast_threadsafe.
            try:
                from services.ws_bridge import notify_touch_discarded
                await notify_touch_discarded(index, discarded_count)
            except Exception as e:
                runtime_state.log(
                    f"[Touch] index={index} no se pudo emitir touch-discarded por WS: {e}"
                )

            return {
                "index": index,
                "listening": False,
                "discarded_count": discarded_count,
            }
touch_service = TouchService()