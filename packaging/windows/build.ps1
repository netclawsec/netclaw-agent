# NetClaw Agent — Windows installer build script.
#
# Run from the repo root:  powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1
#
# Steps:
#   1. uv venv + uv pip install (deps from pyproject.toml + pyinstaller)
#   2. PyInstaller --onedir using packaging/windows/netclaw.spec
#   3. Inno Setup compile packaging/windows/netclaw.iss → dist/NetClaw-Agent-Setup-<ver>.exe
#
# Env knobs:
#   $env:NETCLAW_PYPI_INDEX = "https://mirrors.aliyun.com/pypi/simple/"  (China-friendly)
#   $env:NETCLAW_INNO_PATH  = "C:\Program Files (x86)\Inno Setup 6"

$ErrorActionPreference = "Continue"

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root
Write-Host "===== build.ps1 from $root ====="

$pypiIndex = if ($env:NETCLAW_PYPI_INDEX) { $env:NETCLAW_PYPI_INDEX } else { "https://mirrors.aliyun.com/pypi/simple/" }
$innoDir   = if ($env:NETCLAW_INNO_PATH)  { $env:NETCLAW_INNO_PATH }  else { "C:\Program Files (x86)\Inno Setup 6" }
$iscc      = Join-Path $innoDir "ISCC.exe"

Write-Host "PyPI index : $pypiIndex"
Write-Host "ISCC       : $iscc"

if (-not (Test-Path $iscc)) {
  Write-Host "❌ ISCC.exe not found at $iscc — install Inno Setup 6 first." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "===== 1. uv venv (Python 3.11) ====="
if (-not (Test-Path .venv-build)) {
  cmd /c "uv venv --python 3.11 .venv-build 2>&1"
} else {
  Write-Host ".venv-build already exists; reusing"
}
$pythonExe = Join-Path $root ".venv-build\Scripts\python.exe"

Write-Host ""
Write-Host "===== 2. install deps ====="
# Pre-swap obfuscated license.py with the unobfuscated .clear so the
# bundled binary doesn't pull in pyarmor_runtime (Windows lacks the .pyd).
if ((Test-Path "hermes_cli\license.py.clear") -and -not (Test-Path "hermes_cli\license.py.bak")) {
  Copy-Item "hermes_cli\license.py" "hermes_cli\license.py.bak" -Force
  Copy-Item "hermes_cli\license.py.clear" "hermes_cli\license.py" -Force
  Write-Host "swapped hermes_cli/license.py with unobfuscated copy"
}

cmd /c "uv pip install --python $pythonExe --index-url $pypiIndex pyinstaller 2>&1"
# Install with [desktop] extras: web (fastapi+uvicorn) + cli + mcp + acp + pywebview
cmd /c "uv pip install --python $pythonExe --index-url $pypiIndex -e .[desktop] 2>&1"

Write-Host ""
Write-Host "===== 3. PyInstaller build ====="
cmd /c "$pythonExe -m PyInstaller --noconfirm --clean --distpath dist --workpath build packaging\windows\netclaw.spec 2>&1"
$piExit = $LASTEXITCODE
Write-Host "PyInstaller exit: $piExit"

if (Test-Path "dist\netclaw\netclaw.exe") {
  $size = (Get-ChildItem -Recurse "dist\netclaw" | Measure-Object -Property Length -Sum).Sum / 1MB
  Write-Host ("dist\netclaw size: {0:N1} MB" -f $size)
  Write-Host ""
  Write-Host "===== 4. quick CLI smoke ====="
  cmd /c "dist\netclaw\netclaw.exe --version 2>&1"
  cmd /c "dist\netclaw\netclaw.exe --help 2>&1" | Out-Host
} else {
  Write-Host "❌ PyInstaller failed: dist\netclaw\netclaw.exe missing" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "===== 5. Inno Setup compile ====="
Set-Location packaging\windows
cmd /c "`"$iscc`" netclaw.iss 2>&1"
$isccExit = $LASTEXITCODE
Set-Location $root

Write-Host ""
Write-Host "===== installer artifact ====="
Get-ChildItem dist\NetClaw-Agent-Setup*.exe -ErrorAction SilentlyContinue | Select-Object Name, @{N="MB";E={[math]::Round($_.Length / 1MB, 1)}}, FullName

if ($isccExit -ne 0) {
  Write-Host "❌ Inno Setup failed (exit $isccExit)" -ForegroundColor Red
  exit 1
}
Write-Host ""
Write-Host "✅ Build complete." -ForegroundColor Green
