"""
Puente WebSocket bidireccional con el sidecar Node (instanceModelStore).
NO reemplaza nada de lo que ya existe (snapshot en disco, instance_record_store,
HTTP para acciones puntuales) — esto es solo para empujar/recibir eventos de
"documento de instancia" en tiempo real, sin esperar al próximo poll de Node.

Protocolo: mismos mensajes que src/services/pythonBridgeSocket.js del lado Node.
"""
import asyncio
import json
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.runtime_state import runtime_state

router = APIRouter()


class BridgeManager:
    def __init__(self) -> None:
        self.connections: List[WebSocket] = []
        self._lock = asyncio.Lock()
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        # Última vista que mandó Node por cada índice (instance-model:update)
        self.last_instance_models: Dict[int, Dict[str, Any]] = {}

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Se llama una vez al arrancar (lifespan) para poder emitir
        desde hilos sync (asyncio.to_thread) con broadcast_threadsafe."""
        self.loop = loop

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self.connections.append(ws)
        runtime_state.log_always(f"[ws-bridge] Node conectado ({len(self.connections)} conexión(es))")

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            if ws in self.connections:
                self.connections.remove(ws)
        runtime_state.log_always(f"[ws-bridge] Node desconectado ({len(self.connections)} conexión(es))")

    async def broadcast(self, msg_type: str, payload: Dict[str, Any]) -> None:
        data = json.dumps({"type": msg_type, "payload": payload})
        async with self._lock:
            targets = list(self.connections)
        dead = []
        for ws in targets:
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    if ws in self.connections:
                        self.connections.remove(ws)

    def broadcast_threadsafe(self, msg_type: str, payload: Dict[str, Any]) -> None:
        """Para llamar desde código SYNC que corre en un hilo (asyncio.to_thread),
        como core/adb.py. Si todavía no hay loop enlazado o no hay conexiones,
        simplemente no hace nada (best-effort, igual que el resto del bridge)."""
        if not self.loop:
            return
        try:
            asyncio.run_coroutine_threadsafe(self.broadcast(msg_type, payload), self.loop)
        except Exception:
            pass

    def is_connected(self) -> bool:
        return len(self.connections) > 0

    def get_instance_model(self, index: int) -> Optional[Dict[str, Any]]:
        return self.last_instance_models.get(index)


bridge = BridgeManager()


@router.websocket("/ws/bridge")
async def ws_bridge(ws: WebSocket) -> None:
    await bridge.connect(ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            msg_type = msg.get("type")
            payload = msg.get("payload")

            if msg_type == "ping":
                await ws.send_text(json.dumps({"type": "pong", "ts": time.time()}))
                continue

            if msg_type == "instance-model:update" and isinstance(payload, dict):
                index = payload.get("index")
                if index is not None:
                    bridge.last_instance_models[int(index)] = payload
                    from services.instance_record_store import instance_record_store
                    await asyncio.to_thread(
                        instance_record_store.record_instance_model, int(index), payload
                    )
                continue

            runtime_state.log(f"[ws-bridge] mensaje sin manejar: type={msg_type}")
    except WebSocketDisconnect:
        await bridge.disconnect(ws)
    except Exception as e:
        runtime_state.log_always(f"[ws-bridge] error en conexión: {e}")
        await bridge.disconnect(ws)


# ----------------------------------------------------------------------
# Helpers para que OTROS módulos (monitor, instance_service, adb) le
# avisen a Node algo que detectaron antes del próximo poll HTTP de 3s.
# ----------------------------------------------------------------------

async def notify_instance_event(index: int, event: str, detail: str = "") -> None:
    await bridge.broadcast("instance-event", {"index": index, "event": event, "detail": detail})


async def notify_root_status(index: int, ready: bool, uid: Optional[str] = None) -> None:
    await bridge.broadcast("root-status", {"index": index, "ready": ready, "uid": uid})
async def notify_window_event(hwnd: int, event: str, detail: Optional[Dict[str, Any]] = None) -> None:
    """event: 'window_created' | 'window_closed' | 'window_state_changed'"""
    await bridge.broadcast("window-event", {"hwnd": hwnd, "event": event, **(detail or {})})

async def notify_touch_discarded(index: int, discarded_count: int) -> None:
    """Avisa a Node que una captura de touch fue cancelada y sus gestos
    descartados. Reusa el mismo canal 'instance-event' que ya usa
    touch_service._on_gesture() para 'touch-event' -- así el front puede
    filtrar por 'event' dentro del mismo listener que ya tiene, en vez de
    necesitar un tipo de mensaje WS nuevo."""
    await bridge.broadcast(
        "instance-event",
        {"index": index, "event": "touch-discarded", "discarded_count": discarded_count},
    )