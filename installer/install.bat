@echo off
REM =====================================================================
REM  install.bat
REM  Lanzador de doble clic para install.ps1
REM  - Se posiciona en la carpeta donde está este .bat (por si lo movés).
REM  - Ejecuta PowerShell con ExecutionPolicy Bypass, solo para este proceso.
REM  - install.ps1 se auto-eleva a Administrador si hace falta.
REM =====================================================================

cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"

echo.
pause
