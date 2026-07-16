"""
Graba gestos reales (core/touch_capture.py) y los persiste como "tasks":
lista de pasos (tap/swipe/long_press) con delay entre cada uno. Se
reproducen encolando por services/task_queue (mismo mecanismo que el
resto de acciones, para no pisar otros comandos de la instancia).
Persistencia: DATA_DIR/macros/<index>/<task_id>.json
"""
import asyncio
import json
import os
import time
import uuid
from typing import Dict, List

from config import settings
from core.adb import ADBController
from core.runtime_state import runtime_state
from core.touch_capture import TouchRecorder
from services.instance_service import instance_service
from services.task_queue import task_queue
from services.ws_bridge import bridge


class MacroNotFoundError(Exception):
    pass


class MacroService:
    def __init__(self):
        self._recorders: Dict[int, TouchRecorder] = {}
        self._dir = os.path.join(settings.DATA_DIR, "macros")
        os.makedirs(self._dir, exist_ok=True)

    def _instance_dir(self, index: int) -> str:
        path = os.path.join(self._dir, str(index))
        os.makedirs(path, exist_ok=True)
        return path

    async def start_recording(self, index: int) -> None:
        if index in self._recorders:
            raise RuntimeError(f"Ya hay una grabación en curso para index={index}")
        serial = await asyncio.to_thread(ADBController.resolve_serial, index)
        touch_info = await asyncio.to_thread(ADBController.find_touch_device, index)
        if not touch_info:
            raise RuntimeError(
                f"No se encontró dispositivo táctil en index={index} "
                f"(revisar `adb shell getevent -pl`)"
            )
        resolution = await asyncio.to_thread(ADBController.get_screen_resolution, index)

        def _on_gesture(gesture: Dict) -> None:
            bridge.broadcast_threadsafe("touch-event", {"index": index, "event": "gesture_detected", **gesture})

        recorder = TouchRecorder(
            serial=serial, device=touch_info["device"],
            x_range=touch_info.get("x_range"), y_range=touch_info.get("y_range"),
            screen_w=resolution["width"], screen_h=resolution["height"],
            on_gesture=_on_gesture,
        )
        await asyncio.to_thread(recorder.start)
        self._recorders[index] = recorder
        runtime_state.log_always(f"[macro] grabación iniciada index={index} device={touch_info['device']}")
        await bridge.broadcast("macro-event", {"index": index, "event": "recording_started"})

    async def stop_recording(self, index: int) -> List[Dict]:
        recorder = self._recorders.pop(index, None)
        if not recorder:
            raise RuntimeError(f"No hay grabación en curso para index={index}")
        gestures = await asyncio.to_thread(recorder.stop)
        runtime_state.log_always(f"[macro] grabación detenida index={index}: {len(gestures)} gesto(s)")
        await bridge.broadcast("macro-event", {"index": index, "event": "recording_stopped", "steps": len(gestures)})
        return gestures

    def is_recording(self, index: int) -> bool:
        return index in self._recorders

    def save_task(self, index: int, name: str, steps: List[Dict]) -> Dict:
        task_id = uuid.uuid4().hex[:12]
        record = {"id": task_id, "index": index, "name": name, "steps": steps, "created_at": time.time()}
        path = os.path.join(self._instance_dir(index), f"{task_id}.json")
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
        return record

    def list_tasks(self, index: int) -> List[Dict]:
        directory = self._instance_dir(index)
        tasks = []
        for name in sorted(os.listdir(directory)):
            if name.endswith(".json"):
                try:
                    with open(os.path.join(directory, name), "r", encoding="utf-8") as f:
                        tasks.append(json.load(f))
                except (OSError, json.JSONDecodeError):
                    continue
        return tasks

    def get_task(self, index: int, task_id: str) -> Dict:
        path = os.path.join(self._instance_dir(index), f"{task_id}.json")
        if not os.path.exists(path):
            raise MacroNotFoundError(f"Task {task_id} no encontrada para index={index}")
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def delete_task(self, index: int, task_id: str) -> None:
        path = os.path.join(self._instance_dir(index), f"{task_id}.json")
        if os.path.exists(path):
            os.remove(path)

    async def run_task(self, index: int, task_id: str) -> Dict:
        task = self.get_task(index, task_id)

        async def _replay():
            for step in task["steps"]:
                delay = step.get("delay_before_ms", 0) / 1000
                if delay > 0:
                    await asyncio.sleep(min(delay, 10))
                if step["type"] == "tap":
                    await instance_service.tap(index, step["x"], step["y"])
                elif step["type"] == "swipe":
                    await instance_service.swipe(
                        index, step["x1"], step["y1"], step["x2"], step["y2"], step.get("duration_ms", 300)
                    )
                elif step["type"] == "long_press":
                    await instance_service.long_press(index, step["x"], step["y"], step.get("duration_ms", 800))
            return {"executed_steps": len(task["steps"])}

        return await task_queue.enqueue(index, _replay)


macro_service = MacroService()