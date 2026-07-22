# =====================================================================
#  Git.ps1
#  Verifica la presencia de Git y lo instala si es necesario.
# =====================================================================

function Install-GitIfMissing {
    Write-Step "Comprobando Git"
    if (Test-CommandExists "git") {
        $version = (git --version) -replace "git version ", ""
        Write-Skip "Git ya instalado (v$version)"
        return
    }
    Write-Info "Git no encontrado. Instalando..."
    if (-not (Invoke-Download -Url $Global:GitInstallerUrl -Destination $Global:GitInstallerPath)) {
        throw "No se pudo descargar el instalador de Git."
    }
    $exitCode = Invoke-ExternalInstaller -FilePath $Global:GitInstallerPath -ArgumentList @("/VERYSILENT", "/NORESTART")
    if ($exitCode -ne 0) {
        throw "El instalador de Git terminó con código $exitCode"
    }
    Update-SessionPath
    if (-not (Test-CommandExists "git")) {
        throw "Git se instaló pero no se detecta en PATH. Abre una nueva consola y reintenta."
    }
    Write-Ok "Git instalado correctamente"
}
