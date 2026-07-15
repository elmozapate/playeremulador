# =====================================================================
# LDPlayer.ps1
#
# Instala LDPlayer si no se encuentra y si InstallLDPlayer = $true.
# =====================================================================

function Install-LDPlayerIfMissing {

    Write-Step "Comprobando LDPlayer"

    if (-not $Global:InstallLDPlayer) {

        Write-Skip "Instalación automática de LDPlayer desactivada"

        return
    }


    if (Test-Path $Global:LDPlayerPath) {

        Write-Skip "LDPlayer ya instalado en $($Global:LDPlayerPath)"

        return
    }


    Write-Info "LDPlayer no encontrado. Descargando instalador..."


    $downloadOk = Invoke-Download `
        -Url $Global:LDPlayerInstallerUrl `
        -Destination $Global:LDPlayerInstallerPath


    if (-not $downloadOk) {

        throw "No se pudo descargar el instalador de LDPlayer."
    }


    Write-Info "Instalando LDPlayer (esto puede tardar varios minutos)..."


    $exitCode = Invoke-ExternalInstaller `
        -FilePath $Global:LDPlayerInstallerPath `
        -ArgumentList @("/S")


    if ($exitCode -ne 0) {

        Write-Warn "El instalador de LDPlayer terminó con código $exitCode. Verifica manualmente."

        return
    }


    if (-not (Test-Path $Global:LDPlayerPath)) {

        Write-Warn "LDPlayer se instaló pero no se encontró en la ruta esperada: $($Global:LDPlayerPath)"

        Write-Warn "Ajusta LDPlayerPath en config.ps1 si la instalación usa otra ruta."

        return
    }


    Write-Ok "LDPlayer instalado correctamente"
}