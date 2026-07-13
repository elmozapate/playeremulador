import os


class Settings:
    LDPLAYER_PATH: str = os.getenv("LDPLAYER_PATH", r"C:\LDPlayer\LDPlayer9\ldconsole.exe")
    ADB_PATH: str = os.getenv("ADB_PATH", "adb")
    API_HOST: str = os.getenv("API_HOST", "0.0.0.0")
    API_PORT: int = int(os.getenv("API_PORT", "8000"))
    MONITOR_INTERVAL: float = float(os.getenv("MONITOR_INTERVAL", "5"))
    HEALTH_CACHE_TTL: float = float(os.getenv("HEALTH_CACHE_TTL", "10"))
    ADB_BASE_PORT: int = int(os.getenv("ADB_BASE_PORT", "5555"))


settings = Settings()
