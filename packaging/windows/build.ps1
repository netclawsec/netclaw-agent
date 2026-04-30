# NetClaw Agent — Windows installer build script.
#
# Generic build (no tenant params):
#   powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1
#
# Per-tenant build:
#   powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1 `
#     -TenantSlug acme `
#     -BundleJson C:\path\to\bundle.json
#
# When -BundleJson is supplied, the bundle is validated, embedded into the
# PyInstaller payload, and ISCC is invoked with /D defines so the installer's
# AppId / install dir / output filename are all per-tenant.
#
# Steps:
#   1. uv venv + uv pip install (deps from pyproject.toml + pyinstaller)
#   2. PyInstaller --onedir using packaging/windows/netclaw.spec
#   3. Inno Setup compile packaging/windows/netclaw.iss → dist/<output>.exe
#
# Env knobs:
#   $env:NETCLAW_PYPI_INDEX = "https://mirrors.aliyun.com/pypi/simple/"  (China-friendly)
#   $env:NETCLAW_INNO_PATH  = "C:\Program Files (x86)\Inno Setup 6"

param(
  [string]$TenantSlug,
  [string]$BundleJson,
  [string]$Version = "0.10.0"
)

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

# --- Per-tenant gating: BundleJson + TenantSlug must come together. -----
$perTenant = $false
if ($BundleJson -or $TenantSlug) {
  if (-not $BundleJson -or -not $TenantSlug) {
    Write-Host "❌ -BundleJson and -TenantSlug must be supplied together." -ForegroundColor Red
    exit 1
  }
  if (-not (Test-Path $BundleJson)) {
    Write-Host "❌ bundle.json not found at: $BundleJson" -ForegroundColor Red
    exit 1
  }
  $perTenant = $true
  $BundleJson = (Resolve-Path $BundleJson).Path
  Write-Host "Mode       : per-tenant ($TenantSlug)"
  Write-Host "BundleJson : $BundleJson"
} else {
  Write-Host "Mode       : generic (no bundle.json)"
}

Write-Host ""
Write-Host "===== 1. uv venv (Python 3.11) ====="
if (-not (Test-Path .venv-build)) {
  cmd /c "uv venv --python 3.11 .venv-build 2>&1"
} else {
  Write-Host ".venv-build already exists; reusing"
}
$pythonExe = Join-Path $root ".venv-build\Scripts\python.exe"

# --- Per-tenant validation up front; fail in <30s instead of >15min. ----
if ($perTenant) {
  Write-Host ""
  Write-Host "===== 1a. validate bundle.json ====="
  $helper = Join-Path $root "packaging\windows\build_helpers.py"
  $validated = & $pythonExe $helper validate $BundleJson 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ bundle.json validation failed: $validated" -ForegroundColor Red
    exit 1
  }
  Write-Host "bundle.json OK : $validated"
  $appId          = (& $pythonExe $helper app-id $TenantSlug).Trim()
  $installSubdir  = (& $pythonExe $helper install-subdir $TenantSlug).Trim()
  $outputBase     = (& $pythonExe $helper output-basename $TenantSlug $Version).Trim()
  $tenantNameJson = ($validated | ConvertFrom-Json).tenant_name
  $displayName    = (& $pythonExe $helper display-name $tenantNameJson).Trim()
  Write-Host "AppId          : $appId"
  Write-Host "InstallSubdir  : $installSubdir"
  Write-Host "OutputBase     : $outputBase"
  Write-Host "DisplayName    : $displayName"
  $env:NETCLAW_BUNDLE_JSON = $BundleJson
} else {
  $env:NETCLAW_BUNDLE_JSON = $null
}

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

  # Sanity: per-tenant builds must have bundle.json embedded.
  if ($perTenant) {
    $bundleEmbedded = Test-Path "dist\netclaw\_internal\bundle.json"
    if (-not $bundleEmbedded) {
      Write-Host "❌ bundle.json was not embedded into dist\netclaw\_internal\." -ForegroundColor Red
      exit 1
    }
    Write-Host "bundle.json embedded ✓"
  }

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
if ($perTenant) {
  $isccArgs = @(
    "/DTenantSlug=$TenantSlug",
    "/DTenantDisplayName=$displayName",
    "/DAppId=$appId",
    "/DOutputBaseFilename=$outputBase",
    "/DInstallSubdir=$installSubdir",
    "netclaw.iss"
  )
  Write-Host "ISCC args: $($isccArgs -join ' ')"
  & $iscc @isccArgs
} else {
  & $iscc "netclaw.iss"
}
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
