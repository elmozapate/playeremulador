"""
Operaciones Win32 puras (sin estado) para manipular las ventanas host de
las instancias de LDPlayer. Análogo a core/adb.py pero del lado
"ventana" en vez del lado "Android". No importa nada de services/* —
solo llama a la API de Windows vía ctypes (no requiere pywin32).

Solo funciona en Windows (igual que el resto del proyecto: ldconsole.exe,
psutil.IDLE_PRIORITY_CLASS, etc. ya asumen Windows). En otros SO, el
import no revienta (user32/kernel32 quedan en None) pero cualquier
función lanza WindowManagerError al primer uso.
"""
import ctypes
from ctypes import wintypes
import platform
import time
from typing import Dict, List, Optional


class WindowManagerError(RuntimeError):
    """Error operando sobre una ventana Win32."""


_IS_WINDOWS = platform.system() == "Windows"

if _IS_WINDOWS:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
else:
    user32 = None
    kernel32 = None

SW_HIDE = 0
SW_SHOWNORMAL = 1
SW_SHOWMINIMIZED = 2
SW_MAXIMIZE = 3
SW_SHOW = 5
SW_MINIMIZE = 6
SW_RESTORE = 9

WM_CLOSE = 0x0010
GW_OWNER = 4
SWP_NOZORDER = 0x0004
PROCESS_TERMINATE = 0x0001


class WINDOWPLACEMENT(ctypes.Structure):
    _fields_ = [
        ("length", wintypes.UINT),
        ("flags", wintypes.UINT),
        ("showCmd", wintypes.UINT),
        ("ptMinPosition", wintypes.POINT),
        ("ptMaxPosition", wintypes.POINT),
        ("rcNormalPosition", wintypes.RECT),
    ]


_EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

if _IS_WINDOWS:
    # Firmas explícitas (argtypes/restype): sin esto, ctypes asume que
    # todo devuelve c_int (32 bits) y puede truncar handles/punteros en
    # Windows de 64 bits. Es la causa más común de bugs "fantasma" con
    # ctypes + user32/kernel32.
    user32.EnumWindows.argtypes = [_EnumWindowsProc, wintypes.LPARAM]
    user32.EnumWindows.restype = wintypes.BOOL
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowTextW.restype = ctypes.c_int
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.IsWindow.argtypes = [wintypes.HWND]
    user32.IsWindow.restype = wintypes.BOOL
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.GetWindowRect.restype = wintypes.BOOL
    user32.GetWindowPlacement.argtypes = [wintypes.HWND, ctypes.POINTER(WINDOWPLACEMENT)]
    user32.GetWindowPlacement.restype = wintypes.BOOL
    user32.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
    user32.GetWindow.restype = wintypes.HWND
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.ShowWindow.restype = wintypes.BOOL
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    user32.SetForegroundWindow.restype = wintypes.BOOL
    user32.SetWindowPos.argtypes = [
        wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
        ctypes.c_int, ctypes.c_int, wintypes.UINT,
    ]
    user32.SetWindowPos.restype = wintypes.BOOL
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.PostMessageW.restype = wintypes.BOOL
    user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetClassNameW.restype = ctypes.c_int
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel32.TerminateProcess.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

_STATE_NAMES = {
    SW_SHOWMINIMIZED: "minimized",
    SW_MINIMIZE: "minimized",
    SW_MAXIMIZE: "maximized",
    SW_SHOWNORMAL: "normal",
    SW_RESTORE: "normal",
}


def _check_windows() -> None:
    if not _IS_WINDOWS:
        raise WindowManagerError("window_manager solo está disponible en Windows")


def _ensure_hwnd_valid(hwnd: int) -> None:
    if not user32.IsWindow(wintypes.HWND(hwnd)):
        raise WindowManagerError(f"hwnd={hwnd} ya no es una ventana válida")


def window_exists(hwnd: int) -> bool:
    if not _IS_WINDOWS:
        return False
    return bool(user32.IsWindow(wintypes.HWND(hwnd)))


def enum_windows() -> List[int]:
    _check_windows()
    hwnds: List[int] = []

    def _callback(hwnd, _lparam):
        hwnds.append(int(hwnd))
        return True

    user32.EnumWindows(_EnumWindowsProc(_callback), 0)
    return hwnds


def get_window_pid(hwnd: int) -> Optional[int]:
    _check_windows()
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(wintypes.HWND(hwnd), ctypes.byref(pid))
    return int(pid.value) or None


def get_window_title(hwnd: int) -> str:
    _check_windows()
    length = user32.GetWindowTextLengthW(wintypes.HWND(hwnd))
    buf = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(wintypes.HWND(hwnd), buf, length + 1)
    return buf.value


def is_window_visible(hwnd: int) -> bool:
    _check_windows()
    return bool(user32.IsWindowVisible(wintypes.HWND(hwnd)))


def get_window_rect(hwnd: int) -> Dict[str, int]:
    _check_windows()
    rect = wintypes.RECT()
    if not user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(rect)):
        raise WindowManagerError(f"No se pudo leer el rect de hwnd={hwnd}")
    return {
        "x": rect.left,
        "y": rect.top,
        "width": rect.right - rect.left,
        "height": rect.bottom - rect.top,
    }


def window_area(hwnd: int) -> int:
    try:
        rect = get_window_rect(hwnd)
        return rect["width"] * rect["height"]
    except WindowManagerError:
        return 0


def get_window_state(hwnd: int) -> str:
    """'minimized' | 'maximized' | 'normal' | 'hidden'"""
    _check_windows()
    if not is_window_visible(hwnd):
        return "hidden"
    placement = WINDOWPLACEMENT()
    placement.length = ctypes.sizeof(WINDOWPLACEMENT)
    if not user32.GetWindowPlacement(wintypes.HWND(hwnd), ctypes.byref(placement)):
        raise WindowManagerError(f"No se pudo leer el placement de hwnd={hwnd}")
    return _STATE_NAMES.get(placement.showCmd, "normal")


DIALOG_CLASS = "#32770"  # clase estándar de dialog box de Windows (MessageBox, dialogs de error, etc.)

def get_window_class(hwnd: int) -> str:
    _check_windows()
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(wintypes.HWND(hwnd), buf, 256)
    return buf.value

def find_dialogs_by_pid(pid: int) -> List[Dict]:
    """
    A diferencia de find_windows_by_pid, NO filtra por GW_OWNER==0 (los
    diálogos son casi siempre ventanas 'owned' por la ventana principal),
    y filtra por clase #32770. Devuelve info básica en vez de solo hwnd
    porque el caller normalmente quiere el título del error de una.
    """
    _check_windows()
    matches: List[Dict] = []
    for hwnd in enum_windows():
        if get_window_pid(hwnd) != pid:
            continue
        if not is_window_visible(hwnd):
            continue
        try:
            if get_window_class(hwnd) != DIALOG_CLASS:
                continue
        except Exception:
            continue
        matches.append({"hwnd": hwnd, "title": get_window_title(hwnd)})
    return matches
    """Ventanas de nivel superior (top-level) que pertenecen a `pid`.
    Se filtra por 'sin owner' (GetWindow GW_OWNER == 0), el criterio
    estándar para descartar diálogos/tooltips y quedarse con la ventana
    real de LDPlayer."""
    _check_windows()
    matches: List[int] = []
    for hwnd in enum_windows():
        if get_window_pid(hwnd) != pid:
            continue
        if visible_only and not is_window_visible(hwnd):
            continue
        if user32.GetWindow(wintypes.HWND(hwnd), GW_OWNER):
            continue
        matches.append(hwnd)
    return matches


def find_main_window_for_pid(pid: int, timeout: float = 15.0, poll_interval: float = 0.5) -> Optional[int]:
    """Helper bloqueante (usa time.sleep): espera a que aparezca la
    ventana principal del proceso `pid`. Pensado para uso desde scripts
    sync o desde asyncio.to_thread puntual. services/window_service.py
    NO usa esta función para el registro en caliente (hace su propio
    polling async para no ocupar un worker thread completo)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        candidates = find_windows_by_pid(pid)
        if candidates:
            candidates.sort(key=window_area, reverse=True)
            return candidates[0]
        time.sleep(poll_interval)
    return None


def get_window_info(hwnd: int) -> Dict:
    _check_windows()
    _ensure_hwnd_valid(hwnd)
    visible = is_window_visible(hwnd)
    return {
        "hwnd": hwnd,
        "title": get_window_title(hwnd),
        "pid": get_window_pid(hwnd),
        "state": get_window_state(hwnd),
        "visible": visible,
        "rect": get_window_rect(hwnd) if visible else None,
    }


def minimize(hwnd: int) -> None:
    _check_windows(); _ensure_hwnd_valid(hwnd)
    user32.ShowWindow(wintypes.HWND(hwnd), SW_MINIMIZE)


def maximize(hwnd: int) -> None:
    _check_windows(); _ensure_hwnd_valid(hwnd)
    user32.ShowWindow(wintypes.HWND(hwnd), SW_MAXIMIZE)


def restore(hwnd: int) -> None:
    _check_windows(); _ensure_hwnd_valid(hwnd)
    user32.ShowWindow(wintypes.HWND(hwnd), SW_RESTORE)


def hide(hwnd: int) -> None:
    _check_windows(); _ensure_hwnd_valid(hwnd)
    user32.ShowWindow(wintypes.HWND(hwnd), SW_HIDE)


def show(hwnd: int) -> None:
    _check_windows(); _ensure_hwnd_valid(hwnd)
    user32.ShowWindow(wintypes.HWND(hwnd), SW_SHOW)


def focus(hwnd: int) -> None:
    """Trae la ventana al frente. Si estaba minimizada, primero la
    restaura (SetForegroundWindow no siempre funciona bien sobre una
    ventana minimizada)."""
    _check_windows(); _ensure_hwnd_valid(hwnd)
    if get_window_state(hwnd) == "minimized":
        user32.ShowWindow(wintypes.HWND(hwnd), SW_RESTORE)
    user32.SetForegroundWindow(wintypes.HWND(hwnd))


def move(hwnd: int, x: int, y: int, width: int, height: int) -> None:
    _check_windows(); _ensure_hwnd_valid(hwnd)
    if not user32.SetWindowPos(wintypes.HWND(hwnd), None, x, y, width, height, SWP_NOZORDER):
        raise WindowManagerError(f"No se pudo mover/redimensionar hwnd={hwnd}")


def close(hwnd: int) -> None:
    """Cierre 'suave': WM_CLOSE, igual que clickear la X. La app puede
    ignorarlo; para forzar usar kill_process_of_window()."""
    _check_windows(); _ensure_hwnd_valid(hwnd)
    user32.PostMessageW(wintypes.HWND(hwnd), WM_CLOSE, 0, 0)


def kill_process_of_window(hwnd: int) -> int:
    """Mata (forzado) el proceso dueño de la ventana. Devuelve el pid
    matado. Usa psutil si está disponible (ya es dependencia opcional
    del proyecto, ver core/adb.py); si no, cae a TerminateProcess."""
    _check_windows()
    pid = get_window_pid(hwnd)
    if not pid:
        raise WindowManagerError(f"No se pudo resolver el pid de hwnd={hwnd}")
    try:
        import psutil
        psutil.Process(pid).terminate()
        return pid
    except ImportError:
        handle = kernel32.OpenProcess(PROCESS_TERMINATE, False, pid)
        if not handle:
            raise WindowManagerError(f"No se pudo abrir el proceso pid={pid}")
        try:
            if not kernel32.TerminateProcess(handle, 1):
                raise WindowManagerError(f"No se pudo terminar el proceso pid={pid}")
        finally:
            kernel32.CloseHandle(handle)
        return pid