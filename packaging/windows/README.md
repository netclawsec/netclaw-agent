# NetClaw Agent — Windows Installer Build

Builds `dist/NetClaw-Agent-Setup-<version>.exe` — a single .exe installer that bundles the full netclaw-agent (cli, agent, tools, skills, webui assets) along with a portable Python 3.11 runtime. End users do not need Python or any other prerequisites.

## Prerequisites (build machine)

- Windows 10 build 17763+ or Windows 11
- Python 3.11 (via `py -V:3.11` or default `python.exe`)
- [uv](https://docs.astral.sh/uv/) — `winget install astral-sh.uv`
- [Inno Setup 6](https://jrsoftware.org/isdl.php) — `winget install JRSoftware.InnoSetup` or download the .exe directly
- 4GB+ free disk space (for venv + PyInstaller scratch)

## Quick build

```powershell
# from the repo root
powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1
```

Output: `dist\NetClaw-Agent-Setup-0.10.0.exe`

## What the installer does

| Behavior | Detail |
|---|---|
| Bilingual wizard | Simplified Chinese + English |
| Default install dir | `%LOCALAPPDATA%\Programs\NetClaw\Agent` (per-user, no admin needed) |
| PATH | Optional, on by default — adds install dir to user PATH |
| Start Menu | "NetClaw Agent" group: WebUI launcher, NetClaw 命令行, License 状态, Doctor, Uninstall |
| Desktop icon | On by default — double-click opens WebUI in a native pywebview window (or browser fallback) |
| Silent install | Supports `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART` |
| Uninstaller | Standard Windows entry, removes everything we installed |

## Dual-binary layout

The installer ships TWO executables sharing one `_internal/` directory:

| Binary | Mode | Purpose |
|---|---|---|
| `NetClaw Agent.exe` | windowed (no console) | Default Start Menu / Desktop entry. Spawns local uvicorn + opens pywebview window pointing at `http://127.0.0.1:9119`. Closing the window stops the agent. Falls back to default browser if WebView2 is unavailable. |
| `netclaw.exe` | console | Power user CLI: `netclaw license activate`, `netclaw chat`, `netclaw doctor`, `netclaw status`, etc. Available on `PATH` after install. |

Logs from the GUI launcher live at `%LOCALAPPDATA%\NetClaw\logs\gui-launcher.log`.

## What's bundled

- Python 3.11 runtime (no system Python required)
- All `pyproject.toml` dependencies (openai, anthropic, httpx, pydantic, etc.)
- `hermes_cli/` (the `netclaw` CLI entry point)
- `agent/`, `tools/`, `gateway/`, `plugins/`, `acp_adapter/`, `cron/`
- `skills/` and `optional-skills/`
- `hermes_cli/web_dist/` (built webui assets, if present)

Excluded to keep the installer small: `faster_whisper`, `ctranslate2`, `onnxruntime`, `tkinter`, `pytest`, `matplotlib`, `IPython`, `jupyter`, `modal`, `mautrix`, `wandb`, `pyarmor_runtime` (Windows uses the unobfuscated `license.py.clear`).

## File layout in this directory

```
packaging/windows/
├── README.md            (this file)
├── build.ps1            build script — venv, deps, PyInstaller, Inno Setup
├── netclaw.spec         PyInstaller spec — onedir, console mode
├── netclaw.iss          Inno Setup script — bilingual wizard, shortcuts
├── launcher.py          Thin entry that sets bundled-skills env vars then dispatches to hermes_cli.main
├── i18n/
│   └── ChineseSimplified.isl   Inno Setup community translation
└── scripts/
    └── netclaw-launcher.cmd    User-facing CMD shortcut shown in Start Menu / Desktop
```

## Tweaking

- **PyPI mirror**: set `$env:NETCLAW_PYPI_INDEX = "https://pypi.tuna.tsinghua.edu.cn/simple/"` before running `build.ps1`
- **Hidden imports**: edit `netclaw.spec`'s `hiddenimports = [...]` if PyInstaller misses a dynamic import (rare for openai/anthropic; check with `netclaw.exe doctor`)
- **App version**: bump in two places — `netclaw.spec` (`VERSION =`) and `netclaw.iss` (`#define MyAppVersion`)

## Code signing (NOT yet wired in)

Add `SignTool=...` to `[Setup]` in `netclaw.iss` once you have a code-signing certificate. EV certs from sūotōng / Sectigo / DigiCert work; Azure Trusted Signing also supported via the `signtool sign /sha1 <thumbprint> ...` pattern.

## License activation

After install, the user runs:

```cmd
netclaw license activate NCLW-XXXXX-XXXXX-XXXXX-XXXXX
```

The CLI talks to `https://license.netclawsec.com.cn` (or the `NETCLAW_LICENSE_SERVER` override) and stores the activation token at `%USERPROFILE%\.netclaw\license.json`.
