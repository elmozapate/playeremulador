# =====================================================================
# Pip.ps1
#
# Instala requirements.txt dentro del entorno virtual.
#
# Compatible con Windows PowerShell 5.1 y modo estricto.
# stdout/stderr de pip NO son tratados como excepciones PowerShell.
# =====================================================================

function Install-PipRequirements {

    Write-Step "Instalando dependencias Python (pip install)"

    $requirementsPath = Join-Path `
        $Global:PythonRepoPath `
        "requirements.txt"


    # =============================================================
    # VALIDACIONES
    # =============================================================

    if (-not (Test-Path $requirementsPath)) {

        Write-Warn "No se encontró requirements.txt en $($Global:PythonRepoPath). Se omite pip install."

        return
    }


    if (-not (Test-Path $Global:VenvPython)) {

        throw "El entorno virtual no existe. Ejecuta primero New-VenvIfMissing."
    }


    # =============================================================
    # CONFIGURAR PROCESO
    # =============================================================

    $psi = New-Object System.Diagnostics.ProcessStartInfo

    $psi.FileName               = $Global:VenvPython
    $psi.WorkingDirectory       = $Global:PythonRepoPath
    $psi.UseShellExecute        = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.CreateNoWindow         = $true


    # Compatible con Windows PowerShell 5.1.
    # requirementsPath puede contener espacios.

    $escapedRequirements = '"' + (
        $requirementsPath -replace '"', '\"'
    ) + '"'


    $psi.Arguments = (
        "-m pip install " +
        "-r $escapedRequirements " +
        "--disable-pip-version-check " +
        "--no-input"
    )


    # =============================================================
    # EJECUTAR PIP
    # =============================================================

    $process = New-Object System.Diagnostics.Process

    $process.StartInfo = $psi


    try {

        $started = $process.Start()

        if (-not $started) {

            throw "No se pudo iniciar pip mediante '$($Global:VenvPython)'"
        }


        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()


        $process.WaitForExit()


        $stdout = "$($stdoutTask.GetAwaiter().GetResult())".Trim()
        $stderr = "$($stderrTask.GetAwaiter().GetResult())".Trim()

        $exitCode = $process.ExitCode


        if (-not [string]::IsNullOrWhiteSpace($stdout)) {

            Write-Log "pip stdout -> $stdout"
        }


        if (-not [string]::IsNullOrWhiteSpace($stderr)) {

            Write-Log "pip stderr -> $stderr"
        }


        if ($exitCode -ne 0) {

            $output = @()

            if (-not [string]::IsNullOrWhiteSpace($stdout)) {
                $output += $stdout
            }

            if (-not [string]::IsNullOrWhiteSpace($stderr)) {
                $output += $stderr
            }


            throw "pip install terminó con código $exitCode : $($output -join ' | ')"
        }
    }
    finally {

        if ($null -ne $process) {

            $process.Dispose()
        }
    }


    Write-Ok "Dependencias Python instaladas"
}