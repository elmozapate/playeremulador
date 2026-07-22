# =====================================================================
# Venv.ps1
#
# Crea el entorno virtual (.venv) del bridge Python si no existe.
#
# Compatible con:
#   - Windows PowerShell 5.1
#   - PowerShell 7
#   - Set-StrictMode
#   - $ErrorActionPreference = "Stop"
#
# Get-Python313Command devuelve:
#   FilePath
#   Arguments
#   Display
# =====================================================================


function New-VenvIfMissing {

    Write-Step "Comprobando entorno virtual (.venv)"


    # =============================================================
    # 1. COMPROBAR VENV EXISTENTE
    # =============================================================

    if (Test-Path $Global:VenvPython) {

        Write-Skip "Entorno virtual ya existe en $($Global:VenvPath)"

        return
    }


    # =============================================================
    # 2. OBTENER PYTHON 3.13
    # =============================================================

    $pyCmd = Get-Python313Command

    if ($null -eq $pyCmd) {

        throw "No se encontró Python 3.13 para crear el entorno virtual."
    }


    Write-Info "Python seleccionado: $($pyCmd.Display)"
    Write-Info "Creando entorno virtual en $($Global:VenvPath)..."


    # =============================================================
    # 3. CONSTRUIR ARGUMENTOS
    # =============================================================

    $pythonArgs = @()

    foreach ($argument in $pyCmd.Arguments) {
        $pythonArgs += "$argument"
    }

    $pythonArgs += @(
        "-m",
        "venv",
        ".venv"
    )


    # =============================================================
    # 4. CREAR VENV
    # =============================================================

    Push-Location $Global:PythonRepoPath

    try {

        & $pyCmd.FilePath @pythonArgs

        $exitCode = $LASTEXITCODE

        if ($exitCode -ne 0) {

            throw "Falló la creación del entorno virtual. Python terminó con código $exitCode."
        }
    }
    finally {

        Pop-Location
    }


    # =============================================================
    # 5. VALIDAR VENV
    # =============================================================

    if (-not (Test-Path $Global:VenvPython)) {

        throw "El entorno virtual no se creó correctamente. No existe '$($Global:VenvPython)'."
    }


    # =============================================================
    # 6. ACTUALIZAR PIP
    # =============================================================

    Write-Info "Actualizando pip dentro del entorno virtual..."

    & $Global:VenvPython `
        -m `
        pip `
        install `
        --upgrade `
        pip `
        --disable-pip-version-check `
        --no-input

    $pipExitCode = $LASTEXITCODE

    if ($pipExitCode -ne 0) {

        throw "No se pudo actualizar pip. Código de salida: $pipExitCode."
    }


    Write-Ok "Entorno virtual creado en $($Global:VenvPath)"
}