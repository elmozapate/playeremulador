# test_adb.py
import os
import sys
import subprocess
from config import settings
from core.adb import ADBController

def check_adb():
    """Verifica que adb.exe existe y es ejecutable."""
    adb_path = settings.ADB_PATH
    if not os.path.exists(adb_path):
        print(f"❌ ADB no encontrado en: {adb_path}")
        print("   Revisa tu archivo .env o configura ADB_PATH correctamente.")
        return False
    return True

def check_instance_running(index):
    """Usa ldconsole list2 para ver si la instancia está encendida."""
    ld_path = settings.LDPLAYER_PATH
    if not os.path.exists(ld_path):
        print(f"❌ LDPlayer no encontrado en: {ld_path}")
        return False
    try:
        result = subprocess.run(
            [ld_path, "list2"],
            capture_output=True, text=True, encoding='utf-8'
        )
        for line in result.stdout.splitlines():
            parts = line.split(',')
            if len(parts) >= 5 and int(parts[0]) == index:
                android_started = parts[4] == "1"
                if not android_started:
                    print(f"⚠️ Instancia {index} está apagada. Enciéndela primero.")
                return android_started
        print(f"❌ Instancia {index} no encontrada en list2.")
        return False
    except Exception as e:
        print(f"❌ Error al listar instancias: {e}")
        return False

def test_adb(index=0):
    print(f"Probando ADB en instancia {index}...")

    if not check_adb():
        return

    if not check_instance_running(index):
        print("   No se puede probar ADB si la instancia no está encendida.")
        return

    try:
        # Conectar
        ADBController.connect(index)
        print("✅ Conexión ADB establecida.")

        # Probar get_battery_health
        health = ADBController.get_battery_health(index)
        print(f"🔋 Batería: {health}")

        # Probar set_battery_level (por ejemplo, 80%)
        print("   Estableciendo batería al 80%...")
        ADBController.set_battery_level(index, 80)
        # Verificar cambio
        health2 = ADBController.get_battery_health(index)
        print(f"   Después de set: {health2}")

        # Probar reset_battery
        print("   Restaurando batería a estado real...")
        ADBController.reset_battery(index)
        health3 = ADBController.get_battery_health(index)
        print(f"   Después de reset: {health3}")

        # Probar set_bluetooth (activar)
        print("   Activando Bluetooth (puede fallar si no hay permisos)...")
        result = ADBController.set_bluetooth(index, True)
        print(f"   Resultado: {result[:100]}...")  # recortar por si es largo

        print("✅ Pruebas completadas con éxito.")
    except Exception as e:
        print(f"❌ Error durante las pruebas: {e}")

if __name__ == "__main__":
    test_adb()