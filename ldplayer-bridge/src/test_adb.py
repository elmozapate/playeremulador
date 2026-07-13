# test_adb.py
import asyncio
from core.adb import ADBController
from config import settings

async def test_adb(index=0):
    # Probar conexión
    print(f"Probando ADB en instancia {index}...")
    try:
        # Obtener estado de batería
        battery = ADBController.get_battery_health(index)
        print("Batería:", battery)
        
        # Obtener información del dispositivo
        device_info = ADBController.shell(index, "getprop ro.product.manufacturer")
        print("Fabricante:", device_info.strip())
        
        # Listar paquetes instalados (solo algunos)
        packages = ADBController.shell(index, "pm list packages | head -n 5")
        print("Primeros 5 paquetes:", packages.strip())
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    asyncio.run(test_adb(0))