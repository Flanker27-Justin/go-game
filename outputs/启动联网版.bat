@echo off
rem ============================================================
rem  Gomoku - LAN / network launcher  (double-click this file)
rem  Calls the PowerShell script next to it, which will:
rem    1) check Node.js          2) detect the LAN IP
rem    3) pick a free port       4) open the Windows Firewall
rem    5) start the server       6) print URLs + a terminal QR code
rem    7) open your browser
rem  Close this window to stop the server.
rem  ASCII only on purpose (the .ps1 it calls has a Chinese name, located
rem  by wildcard so this file never depends on the console code page).
rem ============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul
title Gomoku - Network Launcher

cd /d "%~dp0"

rem --- Locate the PowerShell script: prefer the network launcher ---
set "PS1="
if exist "%~dp0启动联网版.ps1" set "PS1=%~dp0启动联网版.ps1"
rem fallback 1: any *.ps1 whose name contains the ASCII-free marker is hard to match,
rem             so just take the first .ps1 that is not the single-player launcher
if not defined PS1 for %%F in ("%~dp0*.ps1") do (
  if not defined PS1 set "PS1=%%~fF"
)
if not defined PS1 (
  echo.
  echo   [ERROR] Cannot find the launcher script ^(*.ps1^) next to this file.
  echo   Please keep 启动联网版.bat and 启动联网版.ps1 in the same folder.
  echo.
  pause
  endlocal & exit /b 1
)

echo   Using launcher: "%PS1%"

where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
)

if errorlevel 1 (
  echo.
  echo   [ERROR] Launcher exited with code %errorlevel%.
  echo   Please screenshot the messages above.
  echo.
  pause
)
endlocal
