# Локальная установка и запуск браузерного демо «Rakis: Heretics» (Windows 10/11, PowerShell).
#   powershell -ExecutionPolicy Bypass -File scripts\setup_web.ps1           — установить, собрать, запустить
#   powershell -ExecutionPolicy Bypass -File scripts\setup_web.ps1 -NoRun    — только установить и собрать
#   powershell -ExecutionPolicy Bypass -File scripts\setup_web.ps1 -Tools    — плюс Python-инструменты и Chromium для тестов
param([switch]$NoRun, [switch]$Tools)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "Не найдено: $cmd. $hint"
    Write-Host "Быстрая установка через winget:  winget install OpenJS.NodeJS.LTS ; winget install Git.Git ; winget install Python.Python.3.12 ; winget install Gyan.FFmpeg"
    exit 1
  }
}
Need node 'Установите Node.js 20+ (https://nodejs.org).'
Need npm 'npm идёт вместе с Node.js.'
$major = [int]((node -p "process.versions.node.split('.')[0]"))
if ($major -lt 20) { Write-Host "Нужен Node.js 20+, сейчас $(node -v)"; exit 1 }

if ((Get-Command git -ErrorAction SilentlyContinue) -and (Test-Path .git)) {
  try { git lfs install --local | Out-Null; git lfs pull } catch { Write-Host '(LFS: пропущено — для веб-версии не обязательно)' }
}

Write-Host '== npm-зависимости (Web\) =='
Set-Location "$Root\Web"
if (Test-Path package-lock.json) { npm ci } else { npm install }

Write-Host '== сборка =='
npm run build

if ($Tools) {
  Write-Host '== Python-инструменты =='
  Need python 'Установите Python 3.10+ (winget install Python.Python.3.12).'
  python -m venv "$Root\.venv"
  & "$Root\.venv\Scripts\python.exe" -m pip install -U pip
  & "$Root\.venv\Scripts\python.exe" -m pip install -r "$Root\Tools\requirements.txt"
  if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { Write-Host 'ВНИМАНИЕ: ffmpeg нужен для пересборки голосов и музыки (winget install Gyan.FFmpeg).' }
  Write-Host '== Chromium для автотестов =='
  npx playwright install chromium
}

Write-Host ''
Write-Host "Готово. Файл игры: $Root\Web\dist\rakis_demo.html (можно открыть двойным щелчком)."
if (-not $NoRun) {
  Write-Host 'Запуск локального сервера: http://localhost:8080  (Ctrl+C — остановить)'
  Start-Process 'http://localhost:8080'
  npm run serve
}
