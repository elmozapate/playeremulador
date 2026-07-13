# test_adb.py
import asyncio
import os
import sys
from config import settings
from core.adb import ADBController
from core.ldplayer import LDConsole

async def test_adb():
    index = 0
    print(f"=== Probando ADB en instancia {index} ===")
    
    # Verificar que el binario de ADB existe
    adb_path = settings.ADB_PATH
    if not os.path.exists(adb_path):
        print(f"❌ ADB no encontrado en: {adb_path}")
        print("   Sugerencia: Configura ADB_PATH en tu .env con la ruta completa a adb.exe de LDPlayer.")
        print("   Ejemplo: ADB_PATH=C:\\LDPlayer\\LDPlayer9\\adb.exe")
        return
    
    # Verificar estado de la instancia
    instances = LDConsole.list_instances()
    inst = next((i for i in instances if i["index"] == index), None)
    if not inst:
        print(f"❌ Instancia {index} no existe")
        return
    
    if not inst["android_started"]:
        print(f"⚠️  Instancia {index} está apagada (android_started=False)")
        print("   Debes encenderla primero (usando /launch o desde LDPlayer)")
        # Opcional: preguntar si quieres encenderla
        # respuesta = input("¿Quieres encenderla ahora? (s/n): ")
        # if respuesta.lower() == 's':
        #     LDConsole.launch(index=index)
        #     await asyncio.sleep(5)  # esperar que arranque
        return
    
    # Intentar conexión ADB
    port = ADBController.get_port(index)
    print(f"Conectando a 127.0.0.1:{port} ...")
    try:
        ADBController.connect(index)
        print("✅ Conexión ADB establecida")
    except Exception as e:
        print(f"❌ Error al conectar ADB: {e}")
        return
    
    # Probar comando básico: devices
    try:
        output = ADBController.shell(index, "getprop ro.product.model")
        print(f"✅ Comando ADB exitoso. Modelo: {output.strip()}")
    except Exception as e:
        print(f"❌ Error ejecutando comando ADB: {e}")
        return
    
    # Probar dumpsys battery
    try:
        battery = ADBController.get_battery_health(index)
        print("✅ Estado de batería:")
        print(f"   Nivel: {battery.get('level', '?')}%")
        print(f"   Salud: {battery.get('health', '?')}")
        print(f"   Estado: {battery.get('status', '?')}")
        if 'temperature_c' in battery:
            print(f"   Temperatura: {battery['temperature_c']}°C")
    except Exception as e:
        print(f"❌ Error obteniendo batería: {e}")

if __name__ == "__main__":
    asyncio.run(test_adb())