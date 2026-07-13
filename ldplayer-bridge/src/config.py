import os

class Settings:
    LDPLAYER_PATH: str = os.getenv("LDPLAYER_PATH", r"C:\LDPlayer\LDPlayer9\ldconsole.exe")
    API_HOST: str = os.getenv("API_HOST", "0.0.0.0")
    API_PORT: int = int(os.getenv("API_PORT", "8000"))
    MONITOR_INTERVAL: float = float(os.getenv("MONITOR_INTERVAL", "5"))
    HEALTH_CACHE_TTL: float = float(os.getenv("HEALTH_CACHE_TTL", "10"))
    ADB_BASE_PORT: int = int(os.getenv("ADB_BASE_PORT", "5555"))

    # Detección inteligente de adb.exe
    @property
    def ADB_PATH(self) -> str:
        adb = os.getenv("ADB_PATH")
        if adb and os.path.exists(adb):
            return adb
        # Si no está definido o no existe, buscar junto a LDPLAYER_PATH
        if self.LDPLAYER_PATH:
            base_dir = os.path.dirname(self.LDPLAYER_PATH)
            possible = os.path.join(base_dir, "adb.exe")
            if os.path.exists(possible):
                return possible
        # Último recurso: usar "adb" en el PATH del sistema
        return "adb"

settings = Settings()