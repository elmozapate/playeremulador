# =====================================================================
# Python.ps1
#
# Verifica que exista Python 3.13.x.
#
# Evita Python 3.14 por compatibilidad con ruedas precompiladas
# como pydantic-core.
#
# Get-Python313Command devuelve:
#
#   FilePath  = ejecutable real
#   Arguments = argumentos base
#   Display   = nombre para logs
#
# Ejemplo:
#
#   FilePath  = C:\Windows\py.exe
#   Arguments = @("-3.13")
#   Display   = py -3.13
#
# Compatible con PowerShell estricto.
# =====================================================================


function Get-Python313Command {

    # =============================================================
    # 1. PYTHON LAUNCHER
    # =============================================================

    if (Test-CommandExists "py") {

        $pyCommand = Get-Command "py.exe" -ErrorAction SilentlyContinue

        if ($null -ne $pyCommand) {

            $pyExe = $pyCommand.Source

            $list = @(
                & $pyExe -0 2>$null
            ) | Out-String

            if ($list -match "3\.13") {

                $version = @(
                    & $pyExe -3.13 --version 2>$null
                ) | Out-String

                if ($version -match "Python 3\.13") {

                    return [PSCustomObject]@{
                        FilePath  = $pyExe
                        Arguments = @("-3.13")
                        Display   = "py -3.13"
                    }
                }
            }
        }
    }


    # =============================================================
    # 2. PYTHON DIRECTO
    # =============================================================

    if (Test-CommandExists "python") {

        $pythonCommand = Get-Command "python.exe" -ErrorAction SilentlyContinue

        if ($null -ne $pythonCommand) {

            $pythonExe = $pythonCommand.Source

            $version = @(
                & $pythonExe --version 2>&1
            ) | Out-String

            $version = $version.Trim()

            if ($version -match "^Python 3\.13(\.|$)") {

                return [PSCustomObject]@{
                    FilePath  = $pythonExe
                    Arguments = @()
                    Display   = "python"
                }
            }
        }
    }


    return $null
}


function Install-PythonIfNeeded {

    Write-Step "Comprobando Python $($Global:PythonRequiredMajorMinor)"

    $pyCmd = Get-Python313Command

    if ($null -ne $pyCmd) {

        Write-Skip "Python $($Global:PythonRequiredMajorMinor) ya disponible ($($pyCmd.Display))"

        return
    }


    # =============================================================
    # INSTALAR PYTHON
    # =============================================================

    Write-Info "Python $($Global:PythonRequiredMajorMinor) no encontrado. Instalando v$($Global:PythonInstallVersion)..."

    Write-Warn "No se instalará Python 3.14: algunas dependencias pueden carecer de ruedas precompiladas."


    if (-not (
        Invoke-Download `
            -Url $Global:PythonExeUrl `
            -Destination $Global:PythonExePath
    )) {

        throw "No se pudo descargar el instalador de Python."
    }


    $exitCode = Invoke-ExternalInstaller `
        -FilePath $Global:PythonExePath `
        -ArgumentList @(

            "/quiet",
            "InstallAllUsers=1",
            "PrependPath=1",
            "Include_test=0"

        )


    if ($exitCode -ne 0) {

        throw "El instalador de Python terminó con código $exitCode"
    }


    # =============================================================
    # ACTUALIZAR PATH
    # =============================================================

    Update-SessionPath


    # =============================================================
    # VALIDAR INSTALACIÓN
    # =============================================================

    $pyCmd = Get-Python313Command

    if ($null -eq $pyCmd) {

        throw "Python se instaló pero no se detecta la versión $($Global:PythonRequiredMajorMinor) en PATH. Abre una nueva consola y reintenta."
    }


    Write-Ok "Python $($Global:PythonRequiredMajorMinor) instalado correctamente ($($pyCmd.Display))"
}