# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for NetClaw Agent on Windows.
# Builds TWO executables in a shared --onedir:
#   1. netclaw.exe        — console CLI (license activate, doctor, chat, ...)
#   2. NetClaw Agent.exe  — windowed launcher; spawns uvicorn + opens pywebview window
#
# Run from repo root:
#   pyinstaller packaging/windows/netclaw.spec --noconfirm --clean
#
# Output: dist/netclaw/{netclaw.exe, "NetClaw Agent.exe", _internal/...}

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules


block_cipher = None
HERMES_ROOT = Path(SPECPATH).resolve().parent.parent
VERSION = "0.10.0"
ICON_PATH = HERMES_ROOT / "packaging" / "windows" / "icon" / "netclaw.ico"
ICON_ARG = str(ICON_PATH) if ICON_PATH.is_file() else None

# Allow PyInstaller's analyser to find webui/api.* and webui/server.py
import sys as _sys
_sys.path.insert(0, str(HERMES_ROOT / "webui"))


# ---------------------------------------------------------------------------
# Bundled data files (skills, optional-skills, web_dist, README, etc.).
# ---------------------------------------------------------------------------

datas = []

web_dist = HERMES_ROOT / "hermes_cli" / "web_dist"
if web_dist.is_dir():
    datas.append((str(web_dist), "hermes_cli/web_dist"))

for skills_dir in ("skills", "optional-skills"):
    src = HERMES_ROOT / skills_dir
    if src.is_dir():
        datas.append((str(src), skills_dir))

# NetClaw WebUI (HTTP server + static frontend) — required by app_launcher_gui.
webui_src = HERMES_ROOT / "webui"
if webui_src.is_dir():
    datas.append((str(webui_src), "webui"))

for filename in ("pyproject.toml", "README.md", "LICENSE", "run_agent.py"):
    src = HERMES_ROOT / filename
    if src.is_file():
        datas.append((str(src), "."))


# ---------------------------------------------------------------------------
# Hidden imports — modules PyInstaller's static analyser misses.
# ---------------------------------------------------------------------------

hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "pydantic.deprecated.decorator",
    "email.mime.multipart",
    "email.mime.text",
    "openai._streaming",
    "openai._client",
    "anthropic._client",
    "anthropic._streaming",
    # Windows pywebview backends (Edge WebView2 / mshtml).
    "webview.platforms.winforms",
    "webview.platforms.edgechromium",
    "webview.platforms.mshtml",
    "clr_loader",
    # hermes subpackages
    "hermes_cli",
    "hermes_cli.main",
    "hermes_cli.license",
    "hermes_cli.config",
    "hermes_cli.commands",
    "hermes_cli.web_server",
    "agent",
    "tools",
    "gateway.status",
    "plugins",
    "acp_adapter",
    "acp_adapter.entry",
    "run_agent",
    "cli",
    "model_tools",
    "toolsets",
    "batch_runner",
    "trajectory_compressor",
    "hermes_constants",
    "hermes_state",
    "hermes_time",
    "hermes_logging",
    "utils",
]

for pkg in (
    "hermes_cli",
    "agent",
    "tools",
    "gateway",
    "plugins",
    "acp_adapter",
    "cron",
    "api",   # webui/api/* (visible because we sys.path.insert webui/ above)
):
    try:
        hiddenimports.extend(collect_submodules(pkg))
    except Exception:
        pass

# Top-level webui server module (we import it as `import server` after
# prepending webui/ to sys.path at runtime).
hiddenimports.append("server")


excludes = [
    "faster_whisper",
    "ctranslate2",
    "onnxruntime",
    "numpy.random.tests",
    "tkinter",
    "pytest",
    "_pytest",
    "matplotlib",
    "IPython",
    "jupyter",
    "modal",
    "mautrix",
    "olm",
    "atroposlib",
    "tinker",
    "wandb",
    "pyarmor_runtime_000000",
]


# ---------------------------------------------------------------------------
# Analysis 1 — CLI binary (console mode).
# ---------------------------------------------------------------------------

a_cli = Analysis(
    [str(HERMES_ROOT / "packaging" / "windows" / "launcher.py")],
    pathex=[str(HERMES_ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz_cli = PYZ(a_cli.pure, a_cli.zipped_data, cipher=block_cipher)
exe_cli = EXE(
    pyz_cli,
    a_cli.scripts,
    [],
    exclude_binaries=True,
    name="netclaw",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=ICON_ARG,
)


# ---------------------------------------------------------------------------
# Analysis 2 — GUI launcher binary (windowed mode, no console pop).
# ---------------------------------------------------------------------------

a_gui = Analysis(
    [str(HERMES_ROOT / "packaging" / "windows" / "app_launcher_gui.py")],
    pathex=[str(HERMES_ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz_gui = PYZ(a_gui.pure, a_gui.zipped_data, cipher=block_cipher)
exe_gui = EXE(
    pyz_gui,
    a_gui.scripts,
    [],
    exclude_binaries=True,
    name="NetClaw Agent",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,  # windowed — Explorer launches without opening cmd
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=ICON_ARG,
)


# ---------------------------------------------------------------------------
# Single COLLECT folds both EXEs into the same dist/netclaw/ tree.
# ---------------------------------------------------------------------------

coll = COLLECT(
    exe_cli,
    exe_gui,
    a_cli.binaries,
    a_cli.zipfiles,
    a_cli.datas,
    a_gui.binaries,
    a_gui.zipfiles,
    a_gui.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="netclaw",
)
