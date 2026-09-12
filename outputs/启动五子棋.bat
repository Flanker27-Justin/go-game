@echo off
rem ============================================================
rem  Gomoku - one-click launcher  (just double-click this file)
rem  It finds the PowerShell script next to it and runs it. That script:
rem    1) checks Node.js   2) starts gomoku-server.js
rem    3) prints local / LAN URLs   4) opens your browser
rem  Close this window to stop the server.
rem  NOTE: this file is intentionally pure ASCII (the .ps1 it calls has a
rem        Chinese name, so we locate it by wildcard instead of hardcoding
rem        the characters - that way cmd.exe never garbles it, whatever the
rem        console code page is).
rem ============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul
title Gomoku Launcher

rem Work from the folder containing this file (%~dp0 ends with a backslash)
cd /d "%~dp0"

rem --- Locate the PowerShell script in this folder ---
set "PS1="
rem 1) preferred name (works when the console code page handles it)
if exist "%~dp0启动五子棋.ps1" set "PS1=%~dp0启动五子棋.ps1"
rem 2) fallback: any *.ps1 in this folder (robust even if the Chinese
rem    filename cannot be matched under the current code page)
if not defined PS1 for %%F in ("%~dp0*.ps1") do if not defined PS1 set "PS1=%%~fF"

if not defined PS1 (
  echo.
  echo   [ERROR] Cannot find the launcher script ^(*.ps1^) next to this file.
  echo   Please make sure 启动五子棋.bat and 启动五子棋.ps1 are in the same folder.
  echo.
  pause
  endlocal & exit /b 1
)

echo   Using launcher: "%PS1%"

rem --- Run it: prefer PowerShell 7 (pwsh), otherwise Windows PowerShell ---
where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
)

rem If the launcher exits abnormally, keep the window open to show the error
if errorlevel 1 (
  echo.
  echo   [ERROR] Launcher exited with code %errorlevel%.
  echo   Please screenshot the messages above.
  echo.
  pause
)
endlocal
