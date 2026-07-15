# =====================================================================
# install.ps1
#
# Launcher / instalador / reparador de PlayerEmulador.
#
# Modos:
#   1. Iniciar
#   2. Revisar / reparar
#   3. Actualizar repositorio
#   4. Reinstalar dependencias
#   5. Volver a clonar repositorio
#   0. Salir
# =====================================================================

$ErrorActionPreference = "Stop"

# =====================================================================
# UTF-8
# =====================================================================

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding = [System.Text.Encoding]::UTF8
    chcp 65001 > $null
}
catch {
}


# =====================================================================
# ROOT
# =====================================================================

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path


# =====================================================================
# CARGAR MoDULOS
# =====================================================================

$FilesToLoad = @(
    "config.ps1",
    "modules\Logger.ps1",
    "modules\Utils.ps1",
    "modules\Menu.ps1",
    "modules\Git.ps1",
    "modules\Node.ps1",
    "modules\Python.ps1",
    "modules\Repo.ps1",
    "modules\Npm.ps1",
    "modules\Venv.ps1",
    "modules\Pip.ps1",
    "modules\Env.ps1",
    "modules\LDPlayer.ps1"
)

foreach ($relativePath in $FilesToLoad) {

    $fullPath = Join-Path $ScriptRoot $relativePath

    if (-not (Test-Path $fullPath)) {
        throw "No se encontro el archivo requerido: $fullPath"
    }

    $raw = Get-Content `
        -Path $fullPath `
        -Raw `
        -Encoding UTF8

    $raw = $raw.TrimStart([char]0xFEFF)

    . ([scriptblock]::Create($raw))
}


# =====================================================================
# DETECTAR INSTALACIoN LISTA
# =====================================================================

function Test-InstallationReady {

    $requiredPaths = @(

        (Join-Path $Global:BasePath ".git"),

        (Join-Path $Global:NodeRepoPath "package.json"),

        (Join-Path $Global:NodeRepoPath "node_modules"),

        (Join-Path $Global:NodeRepoPath ".env"),

        (Join-Path $Global:PythonRepoPath "requirements.txt"),

        $Global:VenvPython
    )


    foreach ($path in $requiredPaths) {

        if (-not (Test-Path $path)) {

            return $false
        }
    }


    # -------------------------------------------------------------
    # NODE
    # -------------------------------------------------------------

    $nodeVersion = Get-InstalledNodeVersion

    if ($nodeVersion -ne $Global:NodeRequiredVersion) {

        return $false
    }


    # -------------------------------------------------------------
    # PYTHON
    # -------------------------------------------------------------

    $python = Get-Python313Command

    if ($null -eq $python) {

        return $false
    }


    return $true
}


# =====================================================================
# UVICORN
# =====================================================================

function Test-Uvicorn {

    Write-Step "Verificando uvicorn en el entorno virtual"

    if (-not (Test-Path $Global:VenvPython)) {

        Write-Warn "No existe el entorno virtual"

        return
    }


    try {

        $output = & $Global:VenvPython `
            -m `
            uvicorn `
            --version

        if ($LASTEXITCODE -ne 0) {

            Write-Warn "uvicorn no respondio correctamente"

            return
        }

        Write-Log "uvicorn -> $output"

        Write-Ok "$output"
    }
    catch {

        Write-Warn "No se pudo verificar uvicorn: $($_.Exception.Message)"
    }
}


# =====================================================================
# INICIAR BRIDGE
# =====================================================================

function Start-Bridge {

    if (-not (Test-InstallationReady)) {

        throw "La instalacion no esta completa. Usa 'Revisar / reparar instalacion'."
    }


    $npmCommand = Get-Command `
        "npm.cmd" `
        -ErrorAction SilentlyContinue


    if ($null -eq $npmCommand) {

        throw "No se encontro npm.cmd en PATH."
    }


    Write-Host ""
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host "  Iniciando PlayerEmulador" -ForegroundColor Cyan
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host ""

    Write-Info "Directorio: $($Global:NodeRepoPath)"
    Write-Info "Ejecutando npm start..."


    # -------------------------------------------------------------
    # NUEVA VENTANA POWERSHELL
    # -------------------------------------------------------------

    $command = @"
Set-Location '$($Global:NodeRepoPath)'
& '$($npmCommand.Source)' start
"@


    $process = Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList @(
        "-NoExit",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        $command
    ) `
        -PassThru


    Write-Ok "PlayerEmulador iniciado. PID launcher: $($process.Id)"
}


# =====================================================================
# REPARACIoN COMPLETA
# =====================================================================

function Invoke-FullRepair {

    Install-GitIfMissing
    Install-NodeIfNeeded
    Install-PythonIfNeeded
    Sync-AllRepos
    Invoke-NpmInstall
    New-VenvIfMissing
    Install-PipRequirements
    Update-EnvFile
    Install-LDPlayerIfMissing
    Test-Uvicorn
}


# =====================================================================
# ACTUALIZAR
# =====================================================================

function Invoke-Update {

    Install-GitIfMissing
    Install-NodeIfNeeded
    Install-PythonIfNeeded

    Sync-AllRepos

    Invoke-NpmInstall

    New-VenvIfMissing
    Install-PipRequirements

    Update-EnvFile

    Test-Uvicorn
}


# =====================================================================
# REINSTALAR DEPENDENCIAS
# =====================================================================

function Invoke-ReinstallDependencies {

    if (-not (Test-Path $Global:NodeRepoPath)) {

        throw "No existe el repositorio Node."
    }


    if (-not (Test-Path $Global:PythonRepoPath)) {

        throw "No existe el repositorio Python."
    }


    # -------------------------------------------------------------
    # NODE_MODULES
    # -------------------------------------------------------------

    $nodeModules = Join-Path `
        $Global:NodeRepoPath `
        "node_modules"


    if (Test-Path $nodeModules) {

        Write-Info "Eliminando node_modules..."

        Remove-Item `
            -Path $nodeModules `
            -Recurse `
            -Force `
            -ErrorAction Stop
    }


    # -------------------------------------------------------------
    # VENV
    # -------------------------------------------------------------

    if (Test-Path $Global:VenvPath) {

        Write-Info "Eliminando entorno virtual..."

        Remove-Item `
            -Path $Global:VenvPath `
            -Recurse `
            -Force `
            -ErrorAction Stop
    }


    Invoke-NpmInstall

    New-VenvIfMissing

    Install-PipRequirements

    Update-EnvFile

    Test-Uvicorn
}


# =====================================================================
# VOLVER A CLONAR
# =====================================================================

function Reset-Repository {

    Write-Host ""
    Write-Warn "Esta operacion eliminara el repositorio local."
    Write-Warn "Se conservara install.log."
    Write-Host ""


    $confirmation = Read-Host "Escribe RECLONAR para continuar"


    if ($confirmation -cne "RECLONAR") {

        Write-Info "Operacion cancelada"

        return $false
    }


    $temporaryLog = $null


    if (Test-Path $Global:LogFile) {

        $temporaryLog = Join-Path `
            $env:TEMP `
            "playeremulador-install-$([guid]::NewGuid()).log"


        Copy-Item `
            -Path $Global:LogFile `
            -Destination $temporaryLog `
            -Force
    }


    Write-Info "Eliminando repositorio local..."


    if (Test-Path $Global:BasePath) {

        Get-ChildItem `
            -Path $Global:BasePath `
            -Force |
        ForEach-Object {

            Remove-Item `
                -Path $_.FullName `
                -Recurse `
                -Force `
                -ErrorAction Stop
        }
    }


    Confirm-DirectoryExists $Global:BasePath


    if (
        $null -ne $temporaryLog -and
        (Test-Path $temporaryLog)
    ) {

        Copy-Item `
            -Path $temporaryLog `
            -Destination $Global:LogFile `
            -Force


        Remove-Item `
            -Path $temporaryLog `
            -Force `
            -ErrorAction SilentlyContinue
    }


    Write-Ok "Repositorio local eliminado"

    return $true
}

 

# =====================================================================
# MAIN
# =====================================================================

function Main {

    Assert-Administrator

    Confirm-DirectoryExists $Global:BasePath

    Initialize-Logger


    while ($true) {

        $mode = Show-MainMenu


        try {

            switch ($mode) {


                # =====================================================
                # START
                # =====================================================

                "start" {

                    if (-not (Test-InstallationReady)) {

                        Write-Host ""

                        Write-Warn "La instalacion no esta completa."

                        Write-Info "Ejecuta primero 'Revisar / reparar instalacion'."

                        Write-Host ""

                        Read-Host "Presiona ENTER para volver al menu"

                        continue
                    }


                    Start-Bridge

                    Write-Host ""

                    Read-Host "Presiona ENTER para volver al menu"
                }


                # =====================================================
                # REPAIR
                # =====================================================

                "repair" {

                    Reset-StepCounter -Total 10

                    Clear-Host

                    Invoke-FullRepair

                    Write-Host ""

                    Write-Ok "Sistema revisado y reparado correctamente"

                    Write-Host ""

                    Read-Host "Presiona ENTER para volver al menu"
                }


                # =====================================================
                # UPDATE
                # =====================================================

                "update" {
                
                    Reset-StepCounter -Total 8

                    Clear-Host

                    Invoke-Update

                    Write-Host ""

                    Write-Ok "Repositorio y dependencias actualizados"

                    Write-Host ""

                    Read-Host "Presiona ENTER para volver al menu"
                }


                # =====================================================
                # DEPENDENCIES
                # =====================================================

                "dependencies" {

                    Reset-StepCounter -Total 5
                
                    Clear-Host

                    Invoke-ReinstallDependencies

                    Write-Host ""

                    Write-Ok "Dependencias reinstaladas correctamente"

                    Write-Host ""

                    Read-Host "Presiona ENTER para volver al menu"
                }


                # =====================================================
                # RECLONE
                # =====================================================

                "reclone" {

                    Clear-Host

                    if (Reset-Repository) {

                        Reset-StepCounter -Total 10

                        Install-GitIfMissing
                        Install-NodeIfNeeded
                        Install-PythonIfNeeded

                        Sync-AllRepos

                        Invoke-NpmInstall

                        # En reclone el venv DEBE ser nuevo.
                        if (Test-Path $Global:VenvPath) {
                            Remove-Item `
                                -Path $Global:VenvPath `
                                -Recurse `
                                -Force `
                                -ErrorAction Stop
                        }

                        New-VenvIfMissing
                        Install-PipRequirements

                        Update-EnvFile
                        Install-LDPlayerIfMissing
                        Test-Uvicorn

                        Write-Host ""
                        Write-Ok "Repositorio reconstruido completamente"
                    }

                    Write-Host ""

                    Read-Host "Presiona ENTER para volver al menu"
                }


                # =====================================================
                # EXIT
                # =====================================================

                "exit" {

                    return
                }
            }
        }
        catch {

            Write-Fail "La operacion se detuvo: $($_.Exception.Message)"

            Write-Host ""

            Write-Host `
                "Revisa el log en: $($Global:LogFile)" `
                -ForegroundColor DarkGray

            Write-Host ""

            Read-Host "Presiona ENTER para volver al menu"
        }
    }
}


Main