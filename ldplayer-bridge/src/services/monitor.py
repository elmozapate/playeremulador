"""
Refresca en background el estado de todas las instancias (polling) y lo
persiste en disco (DATA_DIR/status/all.json vía core.data_store).
v3: sin cache en memoria — Node lee directo el archivo compartido. El
intervalo de refresco sale de runtime_state.monitor_interval (configurable
en caliente vía POST /api/v1/debug/monitor-interval y persistido en disco).
v4: el ciclo ahora compara cada snapshot contra el anterior (en memoria) y
SOLO loguea (vía runtime_state.log_always, siempre visible por stdout ->
Node lo captura y lo reenvía por consola/SSE) cuando detecta un cambio
real: se prendió/apagó, cambió de pid (reinicio del proceso), cambió su
batería, apareció una instancia nueva o desapareció una existente. Si no
hay cambios, se loguea en modo debug nada más (runtime_state.log), para no
inundar la consola en operación normal.
"""
import asyncio
from typing import Any, Dict, List, Optional
from core.adb import ADBController
from core.data_store import data_store
from core.runtime_state import runtime_state
from services.instance_service import instance_service
from services.instance_record_store import instance_record_store

# Se ignoran a propósito window_handle/bound_handle: cambian en cada
# reboot/relaunch sin que eso sea relevante para "salud" del dispositivo.
_WATCHED_INSTANCE_FIELDS = ("android_started", "pid", "vbox_pid", "name")
# Se deja afuera "temperature_c": fluctúa naturalmente y ensuciaría el
# log sin aportar nada accionable.
_WATCHED_BATTERY_FIELDS = ("level", "status", "health")

# Cada cuántos ciclos de refresh se re-inventarían las apps instaladas por
# instancia (evita pegarle a `pm list packages` en cada tick de 5s). Con
# monitor_interval=5s, 12 ciclos ~= 1 minuto; se recalcula sobre el
# intervalo real así que sigue siendo aprox aunque cambie en caliente.
APPS_INVENTORY_EVERY_N_CYCLES = 12
class InstanceMonitor:
    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._last_snapshot: Dict[str, Dict[str, Any]] = {}
        self._initialized = False
        self._cycle_count = 0

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
            # --- Modo reposo: no tocar ADB, casi sin CPU ---
            if runtime_state.sleep_mode:
                await asyncio.sleep(15)      # chequeo ligero cada 15s
                continue
            # -----------------------------------------------
            try:
                await self._refresh()
            except Exception as e:  # noqa: BLE001 - no tumbar el loop de monitoreo
                runtime_state.log_always(f"[monitor] error actualizando snapshot: {e}")
            await asyncio.sleep(runtime_state.monitor_interval)

    def _diff_instance(self, prev: Dict[str, Any], curr: Dict[str, Any]) -> Dict[str, Any]:
        """Compara una instancia contra su versión anterior. Devuelve un
        dict vacío si no hay cambios relevantes."""
        diff: Dict[str, Any] = {}
        for field in _WATCHED_INSTANCE_FIELDS:
            if prev.get(field) != curr.get(field):
                diff[field] = {"antes": prev.get(field), "ahora": curr.get(field)}
        prev_battery = prev.get("battery") or {}
        curr_battery = curr.get("battery") or {}
        battery_diff = {}
        for field in _WATCHED_BATTERY_FIELDS:
            if prev_battery.get(field) != curr_battery.get(field):
                battery_diff[field] = {"antes": prev_battery.get(field), "ahora": curr_battery.get(field)}
        if battery_diff:
            diff["battery"] = battery_diff
        return diff

    async def _refresh(self) -> None:
        instances = await instance_service.list_instances()
        active_indices = {inst["index"] for inst in instances}
        snapshot: Dict[str, Any] = {}
        changes: List[str] = []
        self._cycle_count += 1
        do_inventory = self._initialized and (self._cycle_count % APPS_INVENTORY_EVERY_N_CYCLES == 0)
        for inst in instances:
            idx = inst["index"]
            key = str(idx)
            if inst.get("android_started"):
                # use_cache=True: solo pega a ADB si el health en disco venció
                health = await instance_service.get_health(idx, use_cache=True)
                entry = {**inst, "battery": health.get("battery")}
            else:
                entry = {**inst, "battery": None}
            snapshot[key] = entry
            await asyncio.to_thread(
                instance_record_store.schedule_next_check, idx, runtime_state.monitor_interval
            )
            if do_inventory and inst.get("android_started"):
                try:
                    packages = await instance_service.list_apps(idx, only_third_party=True)
                    await asyncio.to_thread(
                        instance_record_store.record_installed_apps, idx, packages
                    )
                except Exception as e:
                    runtime_state.log(f"[monitor] no se pudo inventariar apps de index={idx}: {e}")
            prev = self._last_snapshot.get(key)
            if prev is None:
                if self._initialized:
                    changes.append(f"index={idx} -> instancia nueva detectada ({entry.get('name')})")
            else:
                diff = self._diff_instance(prev, entry)
                if diff:
                    changes.append(f"index={idx} -> {diff}")
        for key in self._last_snapshot:
            if key not in snapshot:
                changes.append(f"index={key} -> instancia ya no existe (cerrada o eliminada)")
        data_store.write_status_snapshot(snapshot)
        instance_service.prune_health_cache(active_indices)
        ADBController.prune(active_indices)
        await asyncio.to_thread(instance_record_store.prune, active_indices)
        if not self._initialized:
            runtime_state.log_always(f"[monitor] iniciado: {len(instances)} instancia(s) detectada(s)")
            self._initialized = True
        elif changes:
            for change in changes:
                runtime_state.log_always(f"[monitor] cambio detectado: {change}")
        else:
            runtime_state.log(f"[monitor] refresh ok: sin cambios ({len(instances)} instancias activas)")
        self._last_snapshot = snapshot

    def invalidate(self, index: int) -> None:
        data_store.delete_health(index)

    def get_status(self, index: int) -> Optional[Dict[str, Any]]:
        snapshot = data_store.read_status_snapshot() or {}
        return snapshot.get("instances", {}).get(str(index))

    def get_all_status(self) -> Dict[str, Any]:
        snapshot = data_store.read_status_snapshot() or {}
        return snapshot.get("instances", {})

    def invalidate_all(self) -> None:
        data_store.write_status_snapshot({})


monitor = InstanceMonitor()