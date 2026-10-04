# Windows-часть окружения «Rakis: Heretics» (Unreal Engine, Visual Studio, Cursor, Blender).
# Запуск: PowerShell от администратора →  Set-ExecutionPolicy -Scope Process Bypass; .\scripts\install_windows.ps1
# Агентов рекомендуется запускать в WSL2 (Ubuntu) через scripts/install_ubuntu.sh — Codex на нативном Windows экспериментален.

$ErrorActionPreference = "Stop"
function Inst($id, $extra = "") {
  Write-Host "➜ $id" -ForegroundColor Cyan
  winget install --id $id -e --accept-source-agreements --accept-package-agreements $extra
}

Inst Git.Git
Inst OpenJS.NodeJS.LTS
Inst Python.Python.3.12
Inst astral-sh.uv
Inst Anysphere.Cursor
Inst BlenderFoundation.Blender
Inst EpicGames.EpicGamesLauncher

# Visual Studio 2022 с нагрузками для C++ и разработки игр (нужно для C++ проектов UE)
winget install --id Microsoft.VisualStudio.2022.Community -e --accept-source-agreements --accept-package-agreements `
  --override "--quiet --wait --add Microsoft.VisualStudio.Workload.NativeGame --add Microsoft.VisualStudio.Workload.NativeDesktop --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --includeRecommended"

# WSL2 + Ubuntu для агентов
wsl --install -d Ubuntu-24.04

# Необязательно: агенты нативно в Windows
# irm https://claude.ai/install.ps1 | iex
# npm install -g @openai/codex
# irm https://code.kimi.com/kimi-code/install.ps1 | iex

git lfs install
Write-Host "`nДальше вручную:" -ForegroundColor Green
Write-Host " 1. Epic Games Launcher → Unreal Engine → установить 5.x (с Editor symbols for debugging по желанию)"
Write-Host " 2. Создать проект: Games → Third Person → C++ → имя Rakis"
Write-Host " 3. Скопировать пакет в корень проекта, открыть папку в Cursor"
Write-Host " 4. В WSL: bash scripts/install_ubuntu.sh --all"
