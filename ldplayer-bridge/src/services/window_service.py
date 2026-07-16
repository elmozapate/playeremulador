"""
Registro y orquestación de las ventanas host de LDPlayer (Win32) y su
correlación con las instancias (index de ldconsole). Análogo a
services/monitor.py pero para el lado "ventana".

Responsabilidades:
  - Vincular hwnd <-> index cuando se lanza una instancia.
  - Poll periódico: detecta ventanas cerradas / cambios de estado y
    avisa por el mismo canal que ya usa el resto (ws_bridge ->
    window-event, igual patrón que instance-event / root-status).
  - "Modo trabajo": todas las ventanas minimizadas (opcionalmente con
    la pantalla del guest apagada, SIN bloquear el dispositivo) para
    ahorrar recursos de display; se maximiza solo la que se necesita
    para interactuar.

No importa services.instance_service a nivel de módulo (para no crear
un ciclo: instance_service SÍ importa este archivo). Donde hace falta
(apagar pantalla), se importa perezosamente dentro del método.
"""
import asyncio
import time
from typing import Any, Dict, List, Optional

from core import window_manager as wm
from core.ldplayer import LDConsole
from core.runtime_state import runtime_state
from services.instance_record_store import instance_record_store
from services.ws_bridge import notify_window_event

REGISTER_TIMEOUT_S = 20.0   # cuánto esperar a que aparezca la ventana tras un launch
REGISTER_POLL_S = 0.5
POLL_INTERVAL_S = 3.0       # intervalo del poller de estado de ventanas


class WindowService:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._by_hwnd: Dict[int, Dict[str, Any]] = {}   # hwnd -> {index, pid, title, state, ...}
        self._by_index: Dict[int, int] = {}             # index -> hwnd
        self._running = False
        self._task: Optional[asyncio.Task] = None

    # ==================================================================
    # Ciclo de vida del poller
    # ==================================================================
    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _loop(self) -> None:
        while self._running:
            try:
                await self._refresh()
            except Exception as e:  # noqa: BLE001 - no tumbar el loop
                runtime_state.log_always(f"[window] error en poll: {e}")
            await asyncio.sleep(POLL_INTERVAL_S)

    async def _refresh(self) -> None:
        async with self._lock:
            entries = list(self._by_hwnd.items())
        for hwnd, entry in entries:
            index = entry.get("index")
            if not await asyncio.to_thread(wm.window_exists, hwnd):
                await self._forget(hwnd, notify=True, reason="ventana cerrada")
                continue
            try:
                info = await asyncio.to_thread(wm.get_window_info, hwnd)
            except wm.WindowManagerError:
                await self._forget(hwnd, notify=True, reason="ventana inválida")
                continue
            if info["state"] != entry.get("state") or info["title"] != entry.get("title"):
                async with self._lock:
                    entry["state"] = info["state"]
                    entry["title"] = info["title"]
                await notify_window_event(
                    hwnd, "window_state_changed",
                    {"instance_index": index, "state": info["state"], "title": info["title"]},
                )

    # ==================================================================
    # Registro hwnd <-> index
    # ==================================================================
    async def register_for_instance(self, index: int, pid: Optional[int] = None,
                                     timeout: float = REGISTER_TIMEOUT_S) -> Optional[int]:
        """
        Se llama justo después de lanzar una instancia. Busca (con
        reintento, sin bloquear un worker thread completo por 20s de
        una sola vez) la ventana principal del proceso de LDPlayer
        asociado a `index` y la registra.
        """
        if pid is None:
            pid = await asyncio.to_thread(self._resolve_pid, index)
        if not pid:
            runtime_state.log_always(f"[window] index={index}: no se encontró pid para vincular ventana")
            return None

        hwnd = None
        deadline = time.time() + timeout
        while time.time() < deadline:
            candidates = await asyncio.to_thread(wm.find_windows_by_pid, pid)
            if candidates:
                candidates.sort(key=wm.window_area, reverse=True)
                hwnd = candidates[0]
                break
            await asyncio.sleep(REGISTER_POLL_S)

        if hwnd is None:
            runtime_state.log_always(
                f"[window] index={index} pid={pid}: no apareció ventana tras {timeout}s"
            )
            return None

        info = await asyncio.to_thread(wm.get_window_info, hwnd)
        async with self._lock:
            old_hwnd = self._by_index.get(index)
            if old_hwnd is not None:
                self._by_hwnd.pop(old_hwnd, None)
            self._by_hwnd[hwnd] = {
                "index": index, "pid": pid,
                "title": info["title"], "state": info["state"],
                "registered_at": time.time(),
            }
            self._by_index[index] = hwnd

        await asyncio.to_thread(
            instance_record_store.add_event, index, "window", f"Ventana vinculada hwnd={hwnd} pid={pid}",
        )
        await notify_window_event(hwnd, "window_created", {"instance_index": index, "pid": pid})
        runtime_state.log_always(f"[window] index={index} -> hwnd={hwnd} pid={pid} vinculado")
        return hwnd

    @staticmethod
    def _resolve_pid(index: int) -> Optional[int]:
        instances = LDConsole.list_instances()
        info = next((i for i in instances if i["index"] == index), None)
        if not info:
            return None
        return info.get("pid") or info.get("vbox_pid")

    async def unregister_for_instance(self, index: int) -> None:
        async with self._lock:
            hwnd = self._by_index.pop(index, None)
        if hwnd is not None:
            await self._forget(hwnd, notify=True, reason="instancia cerrada")

    async def _forget(self, hwnd: int, notify: bool, reason: str = "") -> None:
        async with self._lock:
            entry = self._by_hwnd.pop(hwnd, None)
            if entry is not None:
                self._by_index.pop(entry.get("index"), None)
        if entry is not None and notify:
            await notify_window_event(
                hwnd, "window_closed", {"instance_index": entry.get("index"), "reason": reason}
            )

    def prune(self, active_indices: set) -> None:
        """Mismo patrón que ADBController.prune / instance_record_store.prune:
        se llama desde monitor._refresh() para soltar ventanas de índices
        que ya no existen (instancia borrada)."""
        stale = [idx for idx in list(self._by_index.keys()) if idx not in active_indices]
        for idx in stale:
            hwnd = self._by_index.pop(idx, None)
            if hwnd is not None:
                self._by_hwnd.pop(hwnd, None)

    # ==================================================================
    # Consultas
    # ==================================================================
    def get_hwnd_for_index(self, index: int) -> Optional[int]:
        return self._by_index.get(index)

    def list_windows(self) -> List[Dict[str, Any]]:
        return [{"hwnd": hwnd, **entry} for hwnd, entry in self._by_hwnd.items()]

    async def get_window_info(self, hwnd: int) -> Dict[str, Any]:
        return await asyncio.to_thread(wm.get_window_info, hwnd)

    # ==================================================================
    # Acciones sobre una ventana puntual
    # ==================================================================
    async def _apply(self, hwnd: int, fn) -> None:
        await asyncio.to_thread(fn, hwnd)
        async with self._lock:
            entry = self._by_hwnd.get(hwnd)
        if entry is not None:
            try:
                info = await asyncio.to_thread(wm.get_window_info, hwnd)
                async with self._lock:
                    entry["state"] = info["state"]
                    entry["title"] = info["title"]
            except wm.WindowManagerError:
                pass

    async def minimize(self, hwnd: int) -> None:
        await self._apply(hwnd, wm.minimize)

    async def maximize(self, hwnd: int) -> None:
        await self._apply(hwnd, wm.maximize)

    async def restore(self, hwnd: int) -> None:
        await self._apply(hwnd, wm.restore)

    async def hide(self, hwnd: int) -> None:
        await self._apply(hwnd, wm.hide)

    async def show(self, hwnd: int) -> None:
        await self._apply(hwnd, wm.show)

    async def focus(self, hwnd: int) -> None:
        await self._apply(hwnd, wm.focus)

    async def move(self, hwnd: int, x: int, y: int, width: int, height: int) -> None:
        await asyncio.to_thread(wm.move, hwnd, x, y, width, height)

    async def close(self, hwnd: int) -> None:
        await asyncio.to_thread(wm.close, hwnd)

    async def kill(self, hwnd: int) -> int:
        pid = await asyncio.to_thread(wm.kill_process_of_window, hwnd)
        await self._forget(hwnd, notify=True, reason="proceso matado manualmente")
        return pid

    # ==================================================================
    # Modo trabajo: todo minimizado, solo se maximiza para interactuar
    # ==================================================================
    @property
    def work_mode(self) -> bool:
        return runtime_state.window_work_mode

    async def enable_work_mode(self, also_screen_off: bool = False) -> Dict[str, Any]:
        runtime_state.window_work_mode = True
        async with self._lock:
            hwnds = list(self._by_hwnd.keys())
        results: Dict[int, str] = {}
        for hwnd in hwnds:
            try:
                await self.minimize(hwnd)
                results[hwnd] = "minimized"
            except wm.WindowManagerError as e:
                results[hwnd] = f"error: {e}"
        if also_screen_off:
            await self._screen_off_all_no_lock()
        runtime_state.log_always(f"[window] modo trabajo ON ({len(hwnds)} ventana(s) minimizada(s))")
        return {"work_mode": True, "windows": results}

    async def disable_work_mode(self) -> Dict[str, Any]:
        runtime_state.window_work_mode = False
        async with self._lock:
            hwnds = list(self._by_hwnd.keys())
        results: Dict[int, str] = {}
        for hwnd in hwnds:
            try:
                await self.restore(hwnd)
                results[hwnd] = "restored"
            except wm.WindowManagerError as e:
                results[hwnd] = f"error: {e}"
        runtime_state.log_always(f"[window] modo trabajo OFF ({len(hwnds)} ventana(s) restaurada(s))")
        return {"work_mode": False, "windows": results}

    async def interact(self, index: int) -> Dict[str, Any]:
        """Trae al frente y maximiza la ventana de `index`. Si el modo
        trabajo está activo, antes minimiza todas las demás -- así solo
        queda visible la que se está usando (ahorra GPU/display del
        resto, que es justo el objetivo del modo trabajo)."""
        hwnd = self.get_hwnd_for_index(index)
        if hwnd is None:
            raise KeyError(f"No hay ventana registrada para index={index}")
        if self.work_mode:
            async with self._lock:
                others = [h for h in self._by_hwnd if h != hwnd]
            for other in others:
                try:
                    await self.minimize(other)
                except wm.WindowManagerError:
                    pass
        await self.restore(hwnd)
        await self.maximize(hwnd)
        await self.focus(hwnd)
        return {"index": index, "hwnd": hwnd, "state": "maximized"}

    async def _screen_off_all_no_lock(self) -> None:
        """Apaga la pantalla del guest en todas las instancias vinculadas
        SIN bloquear el dispositivo (para no necesitar swipe/PIN al
        reactivar). Best-effort: un fallo en una instancia no corta las
        demás. Import perezoso para evitar ciclo con instance_service."""
        from services.instance_service import instance_service
        async with self._lock:
            indices = [entry["index"] for entry in self._by_hwnd.values()]
        for index in indices:
            try:
                # Sin lockscreen -> apagar pantalla no exige desbloquear
                # al reactivar. Requiere root; si no está disponible,
                # simplemente no rompe nada (try/except).
                await instance_service.root_shell(index, "settings put secure lockscreen.disabled 1")
            except Exception:
                pass
            try:
                await instance_service.screen_off(index)
            except Exception:
                pass

    async def screen_on_no_lock(self, index: int) -> None:
        """Contraparte de _screen_off_all_no_lock para una sola instancia."""
        from services.instance_service import instance_service
        try:
            await instance_service.screen_on(index)
        except Exception:
            pass


window_service = WindowService()