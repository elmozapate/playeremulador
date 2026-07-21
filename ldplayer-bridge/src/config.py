import os


class Settings:
    LDPLAYER_PATH: str = os.getenv("LDPLAYER_PATH", r"C:\LDPlayer\LDPlayer9\ldconsole.exe")

    API_HOST: str = os.getenv("PYTHON_HOST", os.getenv("API_HOST", "0.0.0.0"))
    API_PORT: int = int(os.getenv("PYTHON_PORT", os.getenv("API_PORT", "8000")))
    API_KEY: str = os.getenv("PYTHON_API_KEY", "")
    # Valor inicial del intervalo del monitor. Una vez arrancado el proceso
    # el valor "vivo" vive en runtime_state.monitor_interval (persistido en
    # disco, configurable en caliente vía POST /api/v1/debug/monitor-interval).
    MONITOR_INTERVAL: float = float(
        os.getenv("PY_MONITOR_INTERVAL", os.getenv("MONITOR_INTERVAL", "5"))
    )
    
    WINDOW_REGISTER_TIMEOUT_S: float = float(os.getenv("PY_WINDOW_REGISTER_TIMEOUT_S", "30"))
    WINDOW_REGISTER_POLL_S: float = float(os.getenv("PY_WINDOW_REGISTER_POLL_S", "0.5"))
    # Antes en 10s -> el monitor pegaba a ADB casi sin parar con muchas
    # instancias. Default ahora 60s (1 min); configurable por env y
    # también en caliente vía POST /api/v1/debug/health-ttl.
    HEALTH_CACHE_TTL: float = float(
        os.getenv("PY_HEALTH_CACHE_TTL", os.getenv("HEALTH_CACHE_TTL", "60"))
    )

    # Modo verbose apagado por default. Actívalo por env (PY_DEBUG_LOG=1)
    # o en runtime con POST /api/v1/debug/toggle {"enable": true}.
    # OJO: esto solo controla si además de escribirse a logs/service.log
    # (siempre) los logs también salen por stdout.
    DEBUG_LOG: bool = os.getenv("PY_DEBUG_LOG", "0") == "1"

    ADB_BASE_PORT: int = int(os.getenv("ADB_BASE_PORT", "5555"))
    # Perfil aplicado por POST /instances/{index}/initial-root (setup con
    # ROOT + ADB debug). Bajado al mínimo (era 4 cpu / 8192 MB) tras
    # detectar stalls de VirtualBox ("uCountStall < 100") al lanzar varias
    # instancias en simultáneo. Subilo por env si el host tiene margen.
    INITIAL_ROOT_CPU: int = int(os.getenv("PY_INITIAL_ROOT_CPU", "2"))
    INITIAL_ROOT_MEMORY: int = int(os.getenv("PY_INITIAL_ROOT_MEMORY", "2048"))
    # Carpeta compartida en disco donde se persisten status/health/logs y
    # la config runtime. Por default es una carpeta hermana de este
    # proyecto y del bridge Node, junto a /apks, ej:
    #
    #   raiz/
    #     ldplayer-bridge/     <- este proyecto (src/config.py vive acá)
    #     emu-bridge/          <- proyecto Node
    #     apks/
    #     ldplayer-data/       <- DATA_DIR (se crea sola si no existe)
    #
    # Node debe apuntar a la MISMA carpeta (ver config.js -> dataDir /
    # env LDPLAYER_DATA_DIR). Se puede overridear con esa misma env var
    # acá también, para no depender de la ubicación relativa por default.
    DATA_DIR: str = os.getenv(
        "LDPLAYER_DATA_DIR",
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "ldplayer-data")),
    )

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
