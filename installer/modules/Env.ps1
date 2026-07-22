# =====================================================================
# Env.ps1
#
# Genera o actualiza el archivo .env del repo Node.
# Solo administra las claves de $Global:EnvManagedKeys.
# Las demás líneas se conservan.
#
# Compatible con Windows PowerShell 5.1 y modo estricto.
# =====================================================================

function Update-EnvFile {

    Write-Step "Generando/actualizando .env"

    $envPath = Join-Path $Global:NodeRepoPath ".env"

    Confirm-DirectoryExists $Global:NodeRepoPath

    $existingLines = @()

    if (Test-Path $envPath) {

        $existingLines = @(
            Get-Content `
                -Path $envPath `
                -ErrorAction Stop
        )
    }


    # =============================================================
    # CLAVES ADMINISTRADAS
    # =============================================================

    $managedKeys = @(
        $Global:EnvManagedKeys.Keys |
        Sort-Object
    )

    $preservedLines = @()


    # =============================================================
    # CONSERVAR LÍNEAS NO ADMINISTRADAS
    # =============================================================

    foreach ($line in $existingLines) {

        $lineText = "$line"
        $trimmed  = $lineText.Trim()

        if (
            [string]::IsNullOrWhiteSpace($trimmed) -or
            $trimmed.StartsWith("#")
        ) {

            $preservedLines += $lineText

            continue
        }


        if ($trimmed.Contains("=")) {

            $parts = $trimmed -split "=", 2
            $key   = "$($parts[0])".Trim()

            if ($managedKeys -contains $key) {

                # La clave será regenerada.
                continue
            }
        }


        $preservedLines += $lineText
    }


    # =============================================================
    # GENERAR VARIABLES ADMINISTRADAS
    # =============================================================

    $managedLines = @()

    foreach ($key in $managedKeys) {

        $value = "$($Global:EnvManagedKeys[$key])"

        $managedLines += "$key=$value"
    }


    # =============================================================
    # CONSTRUIR ARCHIVO
    # =============================================================

    $finalContent = @()

    $finalContent += "# ---- Variables gestionadas automáticamente por install.ps1 ----"

    foreach ($line in $managedLines) {
        $finalContent += $line
    }

    $finalContent += "# ---- Fin de variables gestionadas ----"


    if ($preservedLines.Count -gt 0) {

        $finalContent += ""

        foreach ($line in $preservedLines) {
            $finalContent += $line
        }
    }


    # =============================================================
    # ESCRIBIR UTF-8 SIN BOM
    # =============================================================

    $content = $finalContent -join [Environment]::NewLine

    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)

    [System.IO.File]::WriteAllText(
        $envPath,
        $content,
        $utf8WithoutBom
    )


    Write-Ok ".env actualizado en $envPath"


    foreach ($key in $managedKeys) {

        Write-Info "  $key = $($Global:EnvManagedKeys[$key])"
    }
}