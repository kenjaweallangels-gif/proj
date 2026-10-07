# Установка проекта на Windows 10/11 (PowerShell 5+). Запуск из корня репозитория:
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
# Что делает: проверяет Git, Node.js 22+, Python 3.11+; ставит зависимости веб-демо (pkg2) и стенда очков (pkg1);
# прогоняет тесты; печатает команды запуска. Ядро pkg1 целиком (Godot, Vosk, сервер) — удобнее в WSL Ubuntu:
#   wsl --install -d Ubuntu-24.04, затем в WSL: bash scripts/setup.sh
param([switch]$SkipTests, [switch]$Full)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Host "Нет $cmd. $hint" -ForegroundColor Red; exit 1 }
}
function Check($what) { if ($LASTEXITCODE -ne 0) { Write-Host "Ошибка: $what (код $LASTEXITCODE)" -ForegroundColor Red; exit $LASTEXITCODE } }
function Ver($text) { if ($text -match '(\d+)\.(\d+)') { return [version]"$($Matches[1]).$($Matches[2])" } return [version]'0.0' }

Write-Host "== Проверка инструментов ==" -ForegroundColor Cyan
Need git  'Установите: winget install Git.Git'
Need node 'Установите Node.js 22 LTS: winget install OpenJS.NodeJS.LTS'
$py = if (Get-Command py -ErrorAction SilentlyContinue) { 'py' } elseif (Get-Command python -ErrorAction SilentlyContinue) { 'python' } else { $null }
if (-not $py) { Write-Host 'Нет Python. Установите: winget install Python.Python.3.12' -ForegroundColor Red; exit 1 }
$nodeV = Ver (node --version); $pyV = Ver (& $py --version)
Write-Host "git $(git --version) · node $nodeV · python $pyV"
if ($nodeV -lt [version]'22.0') { Write-Host 'Нужен Node.js 22 или новее' -ForegroundColor Red; exit 1 }
if ($pyV -lt [version]'3.11') { Write-Host 'Нужен Python 3.11 или новее' -ForegroundColor Red; exit 1 }

Write-Host "`n== Веб-демо и симулятор (pkg2-demo-web) ==" -ForegroundColor Cyan
Push-Location pkg2-demo-web
npm ci; Check 'npm ci'
if (-not $SkipTests) { npm test; Check 'тесты pkg2 (npm test)' }
Pop-Location

Write-Host "`n== Стенд очков и ядро (pkg1-sim-vm, Python) ==" -ForegroundColor Cyan
Push-Location pkg1-sim-vm
if (-not (Test-Path .venv)) { & $py -m venv .venv; Check 'создание .venv' }
$vpy = Join-Path (Get-Location) '.venv\Scripts\python.exe'
& $vpy -m pip install -q -U pip wheel; Check 'pip'
if ($Full) { & $vpy -m pip install -r requirements.txt; Check 'pip install -r requirements.txt' }
else {
  # стенду очков хватает этого; полный набор (сервер, CAD, голос) — с ключом -Full
  & $vpy -m pip install -q numpy opencv-contrib-python-headless scipy pyyaml jsonschema websockets pytest fastapi uvicorn httpx sqlalchemy python-multipart; Check 'pip install'
}
if (-not $SkipTests) {
  $env:PYTHONPATH = 'core;.;tools'
  if ($Full) { & $vpy -m pytest -q tests } else { & $vpy -m pytest -q tests/test_glasses_lab.py }
  Check 'тесты pkg1 (pytest)'
}
Pop-Location

Write-Host "`n== Готово ==" -ForegroundColor Green
Write-Host @"
Симулятор и стенд (откроется браузер):   cd pkg2-demo-web; npm run dev
  симулятор участка    http://localhost:5173/galley.html
  обучение             http://localhost:5173/galley.html#train
  стенд очков          http://localhost:5173/lab.html
Стенд очков (Python):                     powershell -File scripts\lab.ps1 detect | pose-demo | pose | record | analyze | camera
Порядок работы с очками — docs\12_glasses_lab.md
"@
