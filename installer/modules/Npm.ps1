# =====================================================================
#  Npm.ps1
#  Ejecuta npm install en el repositorio Node.
# =====================================================================

function Invoke-NpmInstall {
    Write-Step "Instalando dependencias Node (npm install)"
    if (-not (Test-Path (Join-Path $Global:NodeRepoPath "package.json"))) {
        Write-Warn "No se encontró package.json en $($Global:NodeRepoPath). Se omite npm install."
        return
    }
    Push-Location $Global:NodeRepoPath
    try {
        $output = npm install 2>&1
        Write-Log "npm install -> $output"
        if ($LASTEXITCODE -ne 0) {
            throw "npm install terminó con código $LASTEXITCODE"
        }
        Write-Ok "Dependencias Node instaladas"
    } finally {
        Pop-Location
    }
}
