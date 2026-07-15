# =====================================================================
# Repo.ps1
#
# Sincronización segura del repositorio.
#
# Compatible con:
#   Set-StrictMode
#   $ErrorActionPreference = "Stop"
#
# IMPORTANTE:
# Git NO se ejecuta directamente desde PowerShell.
# Se usa System.Diagnostics.Process para evitar que STDERR de Git
# sea interpretado como error fatal por PowerShell.
# =====================================================================

function Invoke-GitSafe {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [string]$WorkingDirectory = $Global:BasePath
    )

    function ConvertTo-ProcessArgument {
        param(
            [AllowEmptyString()]
            [string]$Value
        )

        if ($null -eq $Value) {
            return '""'
        }

        # Compatible con CommandLineToArgvW / procesos Windows.
        if ($Value -notmatch '[\s"]') {
            return $Value
        }

        $escaped = $Value -replace '(\\*)"', '$1$1\"'
        $escaped = $escaped -replace '(\\+)$', '$1$1'

        return '"' + $escaped + '"'
    }


    $psi = New-Object System.Diagnostics.ProcessStartInfo

    $psi.FileName               = "git.exe"
    $psi.WorkingDirectory       = $WorkingDirectory
    $psi.UseShellExecute        = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.CreateNoWindow         = $true


    # -------------------------------------------------------------
    # Windows PowerShell 5.1 NO dispone de ProcessStartInfo.ArgumentList
    # Construimos Arguments manualmente.
    # -------------------------------------------------------------

    $escapedArguments = @()

    foreach ($argument in $Arguments) {
        $escapedArguments += ConvertTo-ProcessArgument -Value "$argument"
    }

    $psi.Arguments = $escapedArguments -join " "


    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi

    try {

        $started = $process.Start()

        if (-not $started) {
            throw "No se pudo iniciar git.exe"
        }


        # Leer ambos streams asíncronamente para evitar deadlocks.
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()

        $process.WaitForExit()

        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()

        $stdout = "$stdout".Trim()
        $stderr = "$stderr".Trim()

        $combinedOutput = @()

        if (-not [string]::IsNullOrWhiteSpace($stdout)) {
            $combinedOutput += $stdout
        }

        if (-not [string]::IsNullOrWhiteSpace($stderr)) {
            $combinedOutput += $stderr
        }


        return [PSCustomObject]@{
            ExitCode = $process.ExitCode
            StdOut   = $stdout
            StdErr   = $stderr
            Output   = $combinedOutput -join " | "
        }
    }
    finally {

        if ($null -ne $process) {
            $process.Dispose()
        }
    }
}


function Sync-AllRepos {
    Write-Step "Sincronizando repositorio (playeremulador)"

    $basePath = $Global:BasePath
    $gitDir   = Join-Path $basePath ".git"

    Confirm-DirectoryExists $basePath


    # =============================================================
    # 1. INICIALIZAR GIT
    # =============================================================

    if (-not (Test-Path $gitDir)) {

        Write-Info "Inicializando repositorio Git en $basePath..."

        $result = Invoke-GitSafe `
            -Arguments @("init") `
            -WorkingDirectory $basePath

        Write-Log "git init -> $($result.Output)"

        if ($result.ExitCode -ne 0) {
            throw "git init falló: $($result.Output)"
        }

        Write-Ok "Repositorio Git inicializado"
    }
    else {
        Write-Info "Repositorio Git ya inicializado"
    }


    # =============================================================
    # 2. CONSULTAR REMOTES
    # =============================================================

    Write-Info "Comprobando remote origin..."

    $result = Invoke-GitSafe `
        -Arguments @("remote") `
        -WorkingDirectory $basePath

    Write-Log "git remote -> $($result.Output)"

    if ($result.ExitCode -ne 0) {
        throw "No se pudieron consultar los remotes: $($result.Output)"
    }

    $remotes = @(
        $result.StdOut -split "`r?`n" |
        ForEach-Object {
            $_.Trim()
        } |
        Where-Object {
            -not [string]::IsNullOrWhiteSpace($_)
        }
    )

    $hasOrigin = $remotes -contains "origin"


    # =============================================================
    # 3. CONFIGURAR ORIGIN
    # =============================================================

    if (-not $hasOrigin) {

        Write-Info "Configurando remote origin..."

        $result = Invoke-GitSafe `
            -Arguments @(
                "remote",
                "add",
                "origin",
                $Global:RepoUrl
            ) `
            -WorkingDirectory $basePath

        Write-Log "git remote add origin -> $($result.Output)"

        if ($result.ExitCode -ne 0) {
            throw "No se pudo configurar origin: $($result.Output)"
        }

        Write-Ok "Remote origin configurado"
    }
    else {

        $result = Invoke-GitSafe `
            -Arguments @(
                "remote",
                "get-url",
                "origin"
            ) `
            -WorkingDirectory $basePath

        Write-Log "git remote get-url origin -> $($result.Output)"

        if ($result.ExitCode -ne 0) {
            throw "No se pudo consultar origin: $($result.Output)"
        }

        $origin = $result.StdOut.Trim()

        if ($origin -ne $Global:RepoUrl) {

            Write-Warn "Origin apunta a otra URL: $origin"
            Write-Info "Corrigiendo remote origin..."

            $result = Invoke-GitSafe `
                -Arguments @(
                    "remote",
                    "set-url",
                    "origin",
                    $Global:RepoUrl
                ) `
                -WorkingDirectory $basePath

            Write-Log "git remote set-url origin -> $($result.Output)"

            if ($result.ExitCode -ne 0) {
                throw "No se pudo actualizar origin: $($result.Output)"
            }

            Write-Ok "Remote origin actualizado"
        }
        else {
            Write-Info "Remote origin OK"
        }
    }


    # =============================================================
    # 4. EXCLUIR INSTALL.LOG
    # =============================================================

    $gitInfoDir  = Join-Path $gitDir "info"
    $excludeFile = Join-Path $gitInfoDir "exclude"

    Confirm-DirectoryExists $gitInfoDir

    if (-not (Test-Path $excludeFile)) {

        New-Item `
            -ItemType File `
            -Path $excludeFile `
            -Force `
            -ErrorAction Stop |
            Out-Null
    }

    $excludeLines = @(
        Get-Content `
            -Path $excludeFile `
            -ErrorAction SilentlyContinue
    )

    if ($excludeLines -notcontains "/install.log") {

        Add-Content `
            -Path $excludeFile `
            -Value "/install.log" `
            -Encoding UTF8 `
            -ErrorAction Stop

        Write-Info "install.log excluido localmente de Git"
    }


    # =============================================================
    # 5. FETCH
    # =============================================================

    Write-Info "Descargando información del repositorio..."

    $result = Invoke-GitSafe `
        -Arguments @(
            "fetch",
            "origin",
            "--prune"
        ) `
        -WorkingDirectory $basePath

    Write-Log "git fetch origin --prune -> $($result.Output)"

    if ($result.ExitCode -ne 0) {
        throw "git fetch falló: $($result.Output)"
    }

    Write-Ok "Repositorio remoto consultado"


    # =============================================================
    # 6. RAMA REMOTA
    # =============================================================

    $branch = "$($Global:DefaultBranch)".Trim()

    if ([string]::IsNullOrWhiteSpace($branch)) {
        $branch = "master"
    }

    $remoteBranch = "origin/$branch"
    $remoteRef    = "refs/remotes/origin/$branch"

    Write-Info "Comprobando rama remota '$remoteBranch'..."

    $result = Invoke-GitSafe `
        -Arguments @(
            "for-each-ref",
            "--format=%(refname)",
            "refs/remotes/origin/"
        ) `
        -WorkingDirectory $basePath

    Write-Log "git remote refs -> $($result.Output)"

    if ($result.ExitCode -ne 0) {
        throw "No se pudieron consultar ramas remotas: $($result.Output)"
    }

    $remoteRefs = @(
        $result.StdOut -split "`r?`n" |
        ForEach-Object {
            $_.Trim()
        } |
        Where-Object {
            -not [string]::IsNullOrWhiteSpace($_)
        }
    )

    if ($remoteRefs -notcontains $remoteRef) {

        $availableBranches = @(
            $remoteRefs |
            ForEach-Object {
                $_ -replace "^refs/remotes/origin/", ""
            }
        )

        throw "No existe '$remoteBranch'. Ramas disponibles: $($availableBranches -join ', ')"
    }

    Write-Info "Rama remota '$remoteBranch' encontrada"


    # =============================================================
    # 7. CONSULTAR RAMAS LOCALES
    # =============================================================

    $result = Invoke-GitSafe `
        -Arguments @(
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/heads/"
        ) `
        -WorkingDirectory $basePath

    Write-Log "git local refs -> $($result.Output)"

    if ($result.ExitCode -ne 0) {
        throw "No se pudieron consultar ramas locales: $($result.Output)"
    }

    $localBranches = @(
        $result.StdOut -split "`r?`n" |
        ForEach-Object {
            $_.Trim()
        } |
        Where-Object {
            -not [string]::IsNullOrWhiteSpace($_)
        }
    )

    $localBranchExists = $localBranches -contains $branch


    # =============================================================
    # 8. CREAR / ACTIVAR RAMA
    # =============================================================

    if (-not $localBranchExists) {

        Write-Info "Creando rama local '$branch' desde '$remoteBranch'..."

        $result = Invoke-GitSafe `
            -Arguments @(
                "checkout",
                "-B",
                $branch,
                $remoteBranch
            ) `
            -WorkingDirectory $basePath

        Write-Log "git checkout -B -> $($result.Output)"

        if ($result.ExitCode -ne 0) {
            throw "No se pudo crear '$branch': $($result.Output)"
        }

        Write-Ok "Rama local '$branch' creada"
    }
    else {

        Write-Info "Activando rama local '$branch'..."

        $result = Invoke-GitSafe `
            -Arguments @(
                "checkout",
                $branch
            ) `
            -WorkingDirectory $basePath

        Write-Log "git checkout -> $($result.Output)"

        if ($result.ExitCode -ne 0) {
            throw "No se pudo activar '$branch': $($result.Output)"
        }
    }


    # =============================================================
    # 9. SINCRONIZAR
    # =============================================================

    Write-Info "Sincronizando '$branch' con '$remoteBranch'..."

    $result = Invoke-GitSafe `
        -Arguments @(
            "reset",
            "--hard",
            $remoteBranch
        ) `
        -WorkingDirectory $basePath

    Write-Log "git reset --hard -> $($result.Output)"

    if ($result.ExitCode -ne 0) {
        throw "No se pudo sincronizar '$branch': $($result.Output)"
    }

    Write-Ok "Rama '$branch' sincronizada"


    # =============================================================
    # 10. CONFIGURAR UPSTREAM
    # =============================================================

    Write-Info "Configurando seguimiento de '$remoteBranch'..."

    $result = Invoke-GitSafe `
        -Arguments @(
            "branch",
            "--set-upstream-to=$remoteBranch",
            $branch
        ) `
        -WorkingDirectory $basePath

    Write-Log "git upstream -> $($result.Output)"

    if ($result.ExitCode -ne 0) {
        throw "No se pudo configurar upstream: $($result.Output)"
    }

    Write-Ok "Repo sincronizado correctamente en $basePath"


    # =============================================================
    # 11. VALIDAR ESTRUCTURA
    # =============================================================

    Confirm-RepoSubfolders
}


function Confirm-RepoSubfolders {

    foreach ($sub in @(

        @{
            Path = $Global:NodeRepoPath
            Name = "ldplayer-node-bridge"
        },

        @{
            Path = $Global:PythonRepoPath
            Name = "ldplayer-bridge"
        },

        @{
            Path = $Global:ApksPath
            Name = "apks"
        }

    )) {

        if (Test-Path $sub.Path) {
            Write-Info "  -> $($sub.Name) OK"
        }
        else {
            Write-Warn "  -> No se encontró la carpeta '$($sub.Name)' dentro del repo."
        }
    }
}