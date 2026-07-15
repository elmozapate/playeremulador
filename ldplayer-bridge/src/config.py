import os


class Settings:
    LDPLAYER_PATH: str = os.getenv("LDPLAYER_PATH", r"C:\LDPlayer\LDPlayer9\ldconsole.exe")

    API_HOST: str = os.getenv("PYTHON_HOST", os.getenv("API_HOST", "0.0.0.0"))
    API_PORT: int = int(os.getenv("PYTHON_PORT", os.getenv("API_PORT", "8000")))

    MONITOR_INTERVAL: float = float(
        os.getenv("PY_MONITOR_INTERVAL", os.getenv("MONITOR_INTERVAL", "5"))
    )

    # Antes en 10s -> el monitor pegaba a ADB casi sin parar con muchas
    # instancias. Default ahora 60s (1 min); configurable por env y
    # también en caliente vía POST /api/v1/debug/health-ttl.
    HEALTH_CACHE_TTL: float = float(
        os.getenv("PY_HEALTH_CACHE_TTL", os.getenv("HEALTH_CACHE_TTL", "60"))
    )

    # Modo verbose apagado por default. Actívalo por env (PY_DEBUG_LOG=1)
    # o en runtime con POST /api/v1/debug/toggle {"enable": true}.
    DEBUG_LOG: bool = os.getenv("PY_DEBUG_LOG", "0") == "1"

    ADB_BASE_PORT: int = int(os.getenv("ADB_BASE_PORT", "5555"))

    @property
    def ADB_PATH(self) -> str:
        adb = os.getenv("ADB_PATH")
        if adb and os.path.exists(adb):
            return adb
        if self.LDPLAYER_PATH:
            base_dir = os.path.dirname(self.LDPLAYER_PATH)
            possible = os.path.join(base_dir, "adb.exe")
            if os.path.exists(possible):
                return possible
        return "adb"


settings = Settings()