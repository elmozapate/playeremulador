"""
Serializa operaciones por índice de instancia para evitar condiciones de
carrera (ej: lanzar y apagar la misma instancia al mismo tiempo).

FIX vs versión anterior: el worker ya no hace `await func(...)` a ciegas.
Antes se encolaban lambdas *sync* (`lambda: subprocess.run(...)`) y el
await sobre su resultado (un CompletedProcess) reventaba en runtime.
Ahora se detecta si `func` es coroutine o no, y si es sync se despacha
con asyncio.to_thread para no bloquear el event loop.
"""
import asyncio
from typing import Any, Callable, Dict, Optional


class TaskQueue:
    def __init__(self):
        self._queues: Dict[int, asyncio.Queue] = {}
        self._lock = asyncio.Lock()

    async def _get_queue(self, index: int) -> asyncio.Queue:
        async with self._lock:
            if index not in self._queues:
                queue: asyncio.Queue = asyncio.Queue()
                self._queues[index] = queue
                asyncio.create_task(self._worker(index, queue))
            return self._queues[index]

    async def _worker(self, index: int, queue: asyncio.Queue) -> None:
        while True:
            item = await queue.get()
            if item is None:
                queue.task_done()
                break
            func, args, kwargs, future = item
            try:
                if asyncio.iscoroutinefunction(func):
                    result = await func(*args, **kwargs)
                else:
                    result = await asyncio.to_thread(func, *args, **kwargs)
                if not future.done():
                    future.set_result(result)
            except Exception as e:  # noqa: BLE001 - propagamos vía future
                if not future.done():
                    future.set_exception(e)
            finally:
                queue.task_done()

    async def enqueue(self, index: int, func: Callable, *args, timeout: Optional[float] = None, **kwargs) -> Any:
        """Encola una tarea (sync o async) para esa instancia y espera el
        resultado. `timeout`, si se pasa, acota cuánto espera EL LLAMADOR
        (ej. el endpoint HTTP) -- la tarea sigue corriendo en el worker
        (no se cancela a mitad de un comando real de ldconsole/adb, eso
        podría dejar cosas a medias); esto solo evita que un fetch del
        cliente quede colgado para siempre si algo se traba."""
        queue = await self._get_queue(index)
        future = asyncio.get_running_loop().create_future()
        await queue.put((func, args, kwargs, future))
        if timeout is None:
            return await future
        try:
            return await asyncio.wait_for(asyncio.shield(future), timeout=timeout)
        except asyncio.TimeoutError as e:
            raise TimeoutError(
                f"La operación en index={index} no respondió en {timeout}s "
                f"(sigue ejecutándose en segundo plano)"
            ) from e

    async def shutdown(self, index: int) -> None:
        async with self._lock:
            queue: Optional[asyncio.Queue] = self._queues.get(index)
        if queue:
            await queue.put(None)


task_queue = TaskQueue()
