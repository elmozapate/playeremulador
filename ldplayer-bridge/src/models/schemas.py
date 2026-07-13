from typing import Any, Dict, Optional

from pydantic import BaseModel


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