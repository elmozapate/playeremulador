# =====================================================================
#  config.ps1
#  Configuración centralizada del instalador.
#  Edita SOLO este archivo para cambiar versiones, URLs o rutas.
# =====================================================================

# ---- Rutas base ----
$Global:BasePath        = "C:\playeremulador"
$Global:ApksPath        = Join-Path $Global:BasePath "apks"
$Global:NodeRepoPath    = Join-Path $Global:BasePath "ldplayer-node-bridge"
$Global:PythonRepoPath  = Join-Path $Global:BasePath "ldplayer-bridge"
$Global:VenvPath        = Join-Path $Global:PythonRepoPath ".venv"
$Global:VenvPython      = Join-Path $Global:VenvPath "Scripts\python.exe"
$Global:LogFile         = Join-Path $Global:BasePath "install.log"

# ---- Repositorio (EDITAR con la URL real) ----
$Global:RepoUrl         = "https://github.com/elmozapate/playeremulador.git"

# ---- Node ----
$Global:NodeRequiredVersion = "20.19.0"
$Global:NodeMsiUrl          = "https://nodejs.org/dist/v$($Global:NodeRequiredVersion)/node-v$($Global:NodeRequiredVersion)-x64.msi"
$Global:NodeMsiPath         = Join-Path $env:TEMP "node-installer.msi"

# ---- Python ----
# Version concreta 3.13.x a instalar si no hay una 3.13 disponible.
$Global:PythonRequiredMajorMinor = "3.13"
$Global:PythonInstallVersion     = "3.13.2"
$Global:PythonExeUrl              = "https://www.python.org/ftp/python/$($Global:PythonInstallVersion)/python-$($Global:PythonInstallVersion)-amd64.exe"
$Global:PythonExePath             = Join-Path $env:TEMP "python-installer.exe"

# ---- Git ----
$Global:GitInstallerUrl  = "https://github.com/git-for-windows/git/releases/latest/download/Git-64-bit.exe"
$Global:GitInstallerPath = Join-Path $env:TEMP "git-installer.exe"

# ---- LDPlayer ----
$Global:LDPlayerPath        = "C:\LDPlayer\LDPlayer9\ldconsole.exe"
$Global:LDPlayerInstallerUrl = "https://res.ldmnq.com/download/LDPlayer9/LDPlayer9_general.exe"
$Global:LDPlayerInstallerPath = Join-Path $env:TEMP "ldplayer-installer.exe"
$Global:InstallLDPlayer      = $false   # cambia a $true si quieres que el instalador lo gestione

# ---- Variables administradas en el .env ----
# Solo estas claves serán creadas/actualizadas automáticamente; el resto del
# archivo .env (si el usuario añadió algo manual) se preserva intacto.
$Global:EnvManagedKeys = @{
    "PYTHON_BIN"     = $Global:VenvPython
    "PYTHON_SRC_DIR" = Join-Path $Global:PythonRepoPath "src"
    "LDPLAYER_PATH"  = $Global:LDPlayerPath
}

# ---- Total de pasos (para la barra de progreso del log) ----
$Global:DefaultBranch = "master"
