from typing import Any, Dict, Optional, Union, List 

from pydantic import BaseModel, Field

class WarmupRequest(BaseModel):
    indices: List[int] = [0, 1, 2]
    timeout_sec: int = 120
    
class ActionResponse(BaseModel):
    success: bool
    message: str
    index: int


class InstanceStatus(BaseModel):
    index: int
    name: str
    window_handle: str
    bound_handle: str
    android_started: bool
    pid: Optional[int] = None
    vbox_pid: Optional[int] = None
    battery: Optional[Dict[str, Any]] = None


class ModifyRequest(BaseModel):
    cpu: Optional[int] = None
    memory: Optional[int] = None
    resolution: Optional[str] = None  # formato "width,height,dpi"


class KillAppRequest(BaseModel):
    package_name: str


class InstallAppRequest(BaseModel):
    apk_path: str


class RunAppRequest(BaseModel):
    package_name: str


class CloneRequest(BaseModel):
    new_name: Optional[str] = None


# ======================================================================
# Sistema: batería, radios, ubicación, interfaz, input, apps extra
# ======================================================================
class ToggleRequest(BaseModel):
    enable: bool


class BrightnessRequest(BaseModel):
    level: int = Field(..., ge=0, le=255)


class VolumeRequest(BaseModel):
    stream: str = "music"
    level: int = Field(..., ge=0, le=15)


class ScreenTimeoutRequest(BaseModel):
    ms: int = Field(..., ge=1000)


class BatteryLevelRequest(BaseModel):
    level: int = Field(..., ge=0, le=100)


class BatteryStatusRequest(BaseModel):
    status: str  # charging|discharging|not_charging|full|unknown


class GeoRequest(BaseModel):
    lat: float
    lon: float


class RotationLockRequest(BaseModel):
    locked: bool


class KeyRequest(BaseModel):
    keycode: Union[str, int]


class TextRequest(BaseModel):
    text: str


class TapRequest(BaseModel):
    x: int
    y: int


class SwipeRequest(BaseModel):
    x1: int
    y1: int
    x2: int
    y2: int
    duration_ms: int = 300


class LongPressRequest(BaseModel):
    x: int
    y: int
    duration_ms: int = 800


class PackageRequest(BaseModel):
    package_name: str


class PermissionRequest(BaseModel):
    package_name: str
    permission: str


class PlayProtectRequest(BaseModel):
    disable: bool


class RunAppReliableRequest(BaseModel):
    package_name: str
    activity: Optional[str] = None
    timeout_s: float = 6.0

class RootShellRequest(BaseModel):
    command: str
class MoveWindowRequest(BaseModel):
    x: int
    y: int
    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)
class WorkModeRequest(BaseModel):
    also_screen_off: bool = False


# ======================================================================
# Fase 2: escucha de toques reales del dispositivo
# ======================================================================
class TouchStatusResponse(BaseModel):
    index: int
    listening: bool
    device: Optional[str] = None
    serial: Optional[str] = None


class TouchStopResponse(BaseModel):
    index: int
    listening: bool
    gestures: List[Dict[str, Any]]
    count: int