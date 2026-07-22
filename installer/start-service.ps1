# =====================================================================
# start-service.ps1
# Arranque no interactivo para Task Scheduler.
# No abre menú, no abre ventana hija: corre npm start en foreground,
# en ESTE mismo proceso, para que Task Scheduler lo controle directo.
# =====================================================================

$ErrorActionPreference = "Stop"

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    chcp 65001 > $null
} catch {}

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

$FilesToLoad = @(
    "config.ps1",
    "modules\Logger.ps1",
    "modules\Utils.ps1"
)

foreach ($relativePath in $FilesToLoad) {
    $fullPath = Join-Path $ScriptRoot $relativePath
    $raw = (Get-Content -Path $fullPath -Raw -Encoding UTF8).TrimStart([char]0xFEFF)
    . ([scriptblock]::Create($raw))
}

Initialize-Logger

$npmCommand = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
if ($null -eq $npmCommand) {
    throw "No se encontro npm.cmd en PATH."
}

Set-Location $Global:NodeRepoPath

Write-Info "Arrancando bridge en modo servicio (Task Scheduler) desde $($Global:NodeRepoPath)"

& $npmCommand.Source start