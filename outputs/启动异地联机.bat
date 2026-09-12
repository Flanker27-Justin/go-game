@echo off
rem ============================================================
rem  Gomoku - REMOTE (cross-network) one-click launcher
rem  Double-click this file when you and your friend are NOT on
rem  the same network (this is the normal case for this game).
rem
rem  It calls the PowerShell script next to it, which will:
rem    1) check Node.js
rem    2) check cpolar (the tunnel tool that publishes the game to the internet)
rem    3) start the game server locally
rem    4) open a cpolar tunnel and capture the PUBLIC https URL
rem    5) verify that public URL really serves the page
rem    6) print the public URL + a scannable QR code
rem    7) open your browser at the PUBLIC URL
rem  Close this window to stop both the server and the tunnel.
rem
rem  ASCII only on purpose: the .ps1 it calls has a Chinese name and is
rem  located by wildcard, so this file never depends on the code page.
rem ============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul
title Gomoku - Remote Launcher

cd /d "%~dp0"

rem --- Locate the PowerShell script next to this file ---
set "PS1="
if exist "%~dp0启动异地联机.ps1" set "PS1=%~dp0启动异地联机.ps1"
if not defined PS1 for %%F in ("%~dp0*.ps1") do (
  if not defined PS1 set "PS1=%%~fF"
)
if not defined PS1 (
  echo.
  echo   [ERROR] Cannot find the launcher script ^(*.ps1^) next to this file.
  echo   Please keep 启动异地联机.bat and 启动异地联机.ps1 in the same folder.
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
