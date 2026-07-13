# src/core/__init__.py
"""
Capa de infraestructura: invocación directa de ldconsole.exe y adb,
sin lógica de negocio ni async.
"""
from .ldplayer import LDConsole, LDConsoleError
from .adb import ADBController

__all__ = ["LDConsole", "LDConsoleError", "ADBController"]
