# =====================================================================
#  Node.ps1
#  Verifica que Node esté en la versión requerida (o instala/actualiza).
# =====================================================================

function Get-InstalledNodeVersion {
    if (-not (Test-CommandExists "node")) { return $null }
    try {
        return (node -v) -replace "^v", ""
    } catch {
        return $null
    }
}

function Install-NodeIfNeeded {
    Write-Step "Comprobando Node v$($Global:NodeRequiredVersion)"
    $installed = Get-InstalledNodeVersion
    if ($installed -eq $Global:NodeRequiredVersion) {
        Write-Skip "Node v$installed ya instalado"
        return
    }
    if ($installed) {
        Write-Warn "Node v$installed detectado, se requiere v$($Global:NodeRequiredVersion). Actualizando..."
    } else {
        Write-Info "Node no encontrado. Instalando v$($Global:NodeRequiredVersion)..."
    }
    if (-not (Invoke-Download -Url $Global:NodeMsiUrl -Destination $Global:NodeMsiPath)) {
        throw "No se pudo descargar el instalador de Node."
    }
    $exitCode = Invoke-ExternalInstaller -FilePath "msiexec.exe" -ArgumentList @(
        "/i", "`"$($Global:NodeMsiPath)`"", "/qn", "/norestart"
    )
    if ($exitCode -ne 0) {
        throw "El instalador de Node terminó con código $exitCode"
    }
    Update-SessionPath
    $installed = Get-InstalledNodeVersion
    if ($installed -ne $Global:NodeRequiredVersion) {
        Write-Warn "Node instalado pero se detecta v$installed en lugar de v$($Global:NodeRequiredVersion). Continúa bajo tu propio criterio."
    } else {
        Write-Ok "Node v$installed instalado correctamente"
    }
}
