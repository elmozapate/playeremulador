import sys
import os
import subprocess

# Añadir el directorio src al path para importar config
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import settings

def test_adb(index=0):
    print(f"=== Probando ADB en instancia {index} ===")
    
    # Verificar que ADB_PATH existe
    adb_path = settings.ADB_PATH
    if not os.path.exists(adb_path):
        print(f"❌ ADB no encontrado en: {adb_path}")
        print("   Sugerencia: Configura ADB_PATH en tu .env con la ruta completa a adb.exe de LDPlayer.")
        print("   Ejemplo: ADB_PATH=C:\\LDPlayer\\LDPlayer9\\adb.exe")
        return False
    
    print(f"✅ ADB encontrado en: {adb_path}")
    
    port = settings.ADB_BASE_PORT + (index * 2)
    print(f"Conectando a 127.0.0.1:{port}...")
    
    # Intentar conectar
    connect_cmd = [adb_path, "connect", f"127.0.0.1:{port}"]
    result = subprocess.run(connect_cmd, capture_output=True, text=True)
    
    if "connected" not in result.stdout and "already connected" not in result.stdout:
        print(f"❌ No se pudo conectar: {result.stdout.strip()}")
        print("   Asegúrate de que la instancia esté encendida y el puerto esté disponible.")
        return False
    
    print("✅ Conectado")
    
    # Consultar modelo
    model_cmd = [adb_path, "-s", f"127.0.0.1:{port}", "shell", "getprop", "ro.product.model"]
    model_result = subprocess.run(model_cmd, capture_output=True, text=True)
    model = model_result.stdout.strip()
    print(f"Modelo: {model}")
    
    # Consultar batería usando el método get_battery_health de ADBController
    try:
        from core.adb import ADBController
        battery = ADBController.get_battery_health(index)
        print(f"Batería: {battery}")
    except Exception as e:
        print(f"Error al obtener batería: {e}")
        # Fallback: obtener manualmente
        battery_cmd = [adb_path, "-s", f"127.0.0.1:{port}", "shell", "dumpsys", "battery"]
        battery_result = subprocess.run(battery_cmd, capture_output=True, text=True)
        print("Salida cruda de dumpsys battery:")
        print(battery_result.stdout)
    
    return True

if __name__ == "__main__":
    test_adb()