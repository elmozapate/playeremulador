# =====================================================================
# Menu.ps1
#
# Menú principal de PlayerEmulador.
# =====================================================================

function Show-MainMenu {

    while ($true) {

        Clear-Host

        $isReady = Test-InstallationReady


        Write-Host "=====================================================" -ForegroundColor Magenta
        Write-Host "  PlayerEmulador" -ForegroundColor Magenta
        Write-Host "=====================================================" -ForegroundColor Magenta
        Write-Host ""


        if ($isReady) {

            Write-Host "  Estado: LISTO" -ForegroundColor Green
        }
        else {

            Write-Host "  Estado: REQUIERE REVISION" -ForegroundColor Yellow
        }


        Write-Host ""

        Write-Host "  [1] INICIAR PLAYEREMULADOR" -ForegroundColor Cyan

        Write-Host ""

        Write-Host "  [2] Revisar / reparar instalacion"
        Write-Host "  [3] Actualizar repositorio"
        Write-Host "  [4] Reinstalar dependencias"
        Write-Host "  [5] Volver a clonar repositorio"

        Write-Host ""

        Write-Host "  [0] Salir"

        Write-Host ""


        $option = Read-Host "Seleccione una opcion"


        switch ($option) {

            "1" {
                return "start"
            }

            "2" {
                return "repair"
            }

            "3" {
                return "update"
            }

            "4" {
                return "dependencies"
            }

            "5" {
                return "reclone"
            }

            "0" {
                return "exit"
            }

            default {

                Write-Host ""

                Write-Warn "Opcion no valida"

                Start-Sleep -Seconds 1
            }
        }
    }
}