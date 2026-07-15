# =====================================================================
#  Utils.ps1
#  Helpers genéricos reutilizados por el resto de módulos.
# =====================================================================

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-Administrator {
    if (-not (Test-IsAdministrator)) {
        Write-Host "Este instalador necesita permisos de administrador." -ForegroundColor Red
        Write-Host "Relanzando con elevación..." -ForegroundColor Yellow
        $psi = @{
            FilePath     = "powershell.exe"
            ArgumentList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
            Verb         = "RunAs"
        }
        Start-Process @psi
        exit
    }
}

function Test-CommandExists {
    param([string]$Command)
    return $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Invoke-Download {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$Destination
    )
    try {
        Write-Info "Descargando: $Url"
        Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
        return $true
    } catch {
        Write-Fail "Fallo al descargar $Url : $($_.Exception.Message)"
        return $false
    }
}

function Update-SessionPath {
    # Refresca la variable PATH de la sesión actual con los valores
    # de Machine + User, para detectar binarios recién instalados
    # sin tener que abrir una nueva consola.
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath    = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

function Invoke-ExternalInstaller {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$ArgumentList
    )
    $proc = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -Wait -PassThru
    return $proc.ExitCode
}

function Confirm-DirectoryExists {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}
