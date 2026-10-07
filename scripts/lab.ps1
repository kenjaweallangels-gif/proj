# Стенд очков на Windows (то же, что make lab-* в pkg1-sim-vm). Примеры:
#   powershell -File scripts\lab.ps1 detect                         # найти очки: USB, камеры
#   powershell -File scripts\lab.ps1 pose-demo                      # мост позы с синтетикой → galley.html?pose=1
#   powershell -File scripts\lab.ps1 pose -Source viture            # мост позы с очков (после подключения SDK)
#   powershell -File scripts\lab.ps1 record -Source viture -Out rec\still.csv   # 5 мин в покое
#   powershell -File scripts\lab.ps1 analyze -In rec\still.csv -Device viture-luma-ultra
#   powershell -File scripts\lab.ps1 camera -Cam 1
param(
  [Parameter(Position = 0)][ValidateSet('detect', 'pose-demo', 'pose', 'record', 'analyze', 'camera')][string]$Cmd = 'detect',
  [string]$Source = 'viture', [string]$Out = 'rec\still.csv', [string]$In = 'rec\still.csv', [string]$Device = '', [string]$Cam = '0'
)
$ErrorActionPreference = 'Stop'
$Pkg = Join-Path (Split-Path -Parent $PSScriptRoot) 'pkg1-sim-vm'
Set-Location $Pkg
$vpy = Join-Path $Pkg '.venv\Scripts\python.exe'
if (-not (Test-Path $vpy)) { Write-Host 'Сначала: powershell -ExecutionPolicy Bypass -File scripts\setup.ps1' -ForegroundColor Red; exit 1 }
$env:PYTHONPATH = 'core;.;tools'
switch ($Cmd) {
  'detect'    { & $vpy -m glasses_lab.detect --cameras --json out\lab\detect.json }
  'pose-demo' { & $vpy -m glasses_lab.pose_bridge --source demo }
  'pose'      { & $vpy -m glasses_lab.pose_bridge --source $Source }
  'record'    { & $vpy -m glasses_lab.pose_bridge --source $Source --record $Out --seconds 300 }
  'analyze'   { if ($Device) { & $vpy -m glasses_lab.imu_analyze $In --still --save $Device } else { & $vpy -m glasses_lab.imu_analyze $In --still } }
  'camera'    { & $vpy -m glasses_lab.camera_check --cam $Cam }
}
