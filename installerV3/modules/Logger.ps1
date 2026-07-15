# =====================================================================
# Logger.ps1
#
# Salida en consola + fichero de log.
# Contador de pasos dinámico por operación.
# =====================================================================

$Global:CurrentStep = 0
$Global:TotalSteps  = 0


function Initialize-Logger {

    param(
        [string]$Path = $Global:LogFile
    )

    $dir = Split-Path -Parent $Path

    if (-not (Test-Path $dir)) {

        New-Item `
            -ItemType Directory `
            -Path $dir `
            -Force |
        Out-Null
    }


    "===== Sesión iniciada: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') =====" |
        Out-File `
            -FilePath $Path `
            -Encoding UTF8
}


function Reset-StepCounter {

    param(
        [Parameter(Mandatory = $true)]
        [int]$Total
    )

    $Global:CurrentStep = 0
    $Global:TotalSteps  = $Total
}


function Write-Log {

    param(
        [string]$Message
    )

    if (
        -not [string]::IsNullOrWhiteSpace(
            "$($Global:LogFile)"
        )
    ) {

        "$(Get-Date -Format 'HH:mm:ss')  $Message" |
            Out-File `
                -FilePath $Global:LogFile `
                -Append `
                -Encoding UTF8
    }
}


function Write-Step {

    param(
        [string]$Title
    )

    $Global:CurrentStep++


    if ($Global:TotalSteps -gt 0) {

        $line = "[$($Global:CurrentStep)/$($Global:TotalSteps)] $Title..."
    }
    else {

        $line = "[$($Global:CurrentStep)] $Title..."
    }


    Write-Host ""

    Write-Host `
        $line `
        -ForegroundColor Cyan


    Write-Log $line
}


function Write-Ok {

    param(
        [string]$Message = "OK"
    )

    Write-Host `
        "  OK  $Message" `
        -ForegroundColor Green

    Write-Log "OK  $Message"
}


function Write-Skip {

    param(
        [string]$Message = "Ya presente, se omite"
    )

    Write-Host `
        "  ->  $Message" `
        -ForegroundColor DarkGray

    Write-Log "SKIP  $Message"
}


function Write-Warn {

    param(
        [string]$Message
    )

    Write-Host `
        "  !!  $Message" `
        -ForegroundColor Yellow

    Write-Log "WARN  $Message"
}


function Write-Fail {

    param(
        [string]$Message
    )

    Write-Host `
        "  X   $Message" `
        -ForegroundColor Red

    Write-Log "ERROR  $Message"
}


function Write-Info {

    param(
        [string]$Message
    )

    Write-Host `
        "  >   $Message" `
        -ForegroundColor White

    Write-Log "INFO  $Message"
}