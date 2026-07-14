$adb = "C:\LDPlayer\LDPlayer9\adb.exe"
$ld  = "C:\LDPlayer\LDPlayer9\ldconsole.exe"

Write-Host "--- Estado antes del launch ---"
& $ld list2

Write-Host "--- Lanzando instancia 1 ---"
& $ld launch --index 1

Write-Host "--- Esperando boot (60s) ---"
Start-Sleep -Seconds 60

Write-Host "--- Estado despues del launch ---"
& $ld list2

Write-Host "--- Dispositivos ADB ---"
& $adb devices -l