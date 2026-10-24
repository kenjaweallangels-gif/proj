@echo off
rem Orbital Station Aurora - Windows launcher for the desktop build (secondary platform; Ubuntu is primary).
rem Runs the packaged app if present, otherwise the browser version (START-Windows.bat) of the PC package.
title Orbital Station Aurora
cd /d "%~dp0"
set "APP="
for %%F in ("%~dp0*portable.exe" "%~dp0desktop\*portable.exe" "%~dp0release\*portable.exe" "%~dp0..\release\*portable.exe") do if exist "%%~F" set "APP=%%~F"
if not defined APP for %%F in ("%~dp0win-unpacked\orbital-station-aurora.exe" "%~dp0desktop\win-unpacked\orbital-station-aurora.exe" "%~dp0release\win-unpacked\orbital-station-aurora.exe" "%~dp0..\release\win-unpacked\orbital-station-aurora.exe" "%LOCALAPPDATA%\Programs\orbital-station-aurora\orbital-station-aurora.exe") do if exist "%%~F" set "APP=%%~F"
if defined APP (
  start "" "%APP%" %*
  goto :eof
)
if exist "%~dp0START-Windows.bat" (
  echo Desktop build not found, starting the browser version...
  call "%~dp0START-Windows.bat"
  goto :eof
)
echo Desktop build not found. Build it with: npm ci ^&^& npm run dist:win   (see desktop\README-RU.md)
pause
