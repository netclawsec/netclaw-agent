# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for NetClaw Agent (based on hermes-agent source tree).
# Build:
#   pyinstaller packaging/macos/netclaw.spec --noconfirm --clean
#
# Produces: dist/NetClaw Agent.app

from pathlib import Path

block_cipher = None

HERMES_ROOT = Path(SPECPATH).resolve().parent.parent  # .../hermes-agent
APP_NAME = "NetClaw Agent"
BUNDLE_ID = "com.netclaw.agent"
import os as _os
VERSION = _os.environ.get("VERSION") or _os.environ.get("AGENT_VERSION") or "0.10.0"

# Allow PyInstaller's analyser to find webui/api.* and webui/server.py
import sys as _sys
_sys.path.insert(0, str(HERMES_ROOT / "webui"))


# ---------------------------------------------------------------------------
# Collected data files — must live inside the app bundle.
# ---------------------------------------------------------------------------
#
# Each tuple is (source_path_on_disk, target_relative_path_inside_bundle).
# Target paths are relative to .app/Contents/Resources/.

datas = []

# Pre-built webui assets (run `npm run build` in web/ before packaging).
web_dist = HERMES_ROOT / "hermes_cli" / "web_dist"
if web_dist.is_dir():
    datas.append((str(web_dist), "hermes_cli/web_dist"))

# Skills directories — agent skills that should ship with the app.
for skills_dir in ("skills", "optional-skills"):
    src = HERMES_ROOT / skills_dir
    if src.is_dir():
        datas.append((str(src), skills_dir))

# NetClaw WebUI (HTTP server + static frontend) — required by app_launcher.
webui_src = HERMES_ROOT / "webui"
if webui_src.is_dir():
    datas.append((str(webui_src), "webui"))

# Version / metadata files the CLI reads at startup.
for filename in ("pyproject.toml", "README.md", "LICENSE", "run_agent.py"):
    src = HERMES_ROOT / filename
    if src.is_file():
        datas.append((str(src), "."))


# ---------------------------------------------------------------------------
# Hidden imports — modules PyInstaller's static analyser misses.
# ---------------------------------------------------------------------------

hiddenimports = [
    # uvicorn transport layers
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.uvloop",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",

    # FastAPI / Starlette / Pydantic dynamic imports
    "pydantic.deprecated.decorator",
    "email.mime.multipart",
    "email.mime.text",

    # pywebview cocoa backend
    "webview.platforms.cocoa",

    # New batch-edit pipeline (deferred import in routes.py)
    "api.batch_edit",
    # SSRF-safe URL fetcher (deferred import in studio routes)
    "api.url_safety",
    # Engagement automation rules (deferred import in routes.py)
    "api.engagement",
    # Multi-account registry (deferred import in routes.py)
    "api.accounts",
    # Publish worker spawned at server start (deferred import)
    "api.publish_worker",

    # Cocoa Edit menu installer in app_launcher uses Foundation.NSTimer +
    # AppKit (NSApplication / NSMenu / NSMenuItem). Both are picked up by
    # `import webview` already so no extra hiddenimports needed.

    # Aliyun OSS SDK — ContentStudio uploads local reference images to a
    # public-read bucket so the qixin/happyhorse models can fetch them.
    "oss2",
    "aliyunsdkcore",

    # hermes subpackages that may only be imported via string lookup
    "hermes_cli",
    "hermes_cli.main",
    "hermes_cli.license",
    "hermes_cli.web_server",
    "hermes_cli.config",
    "hermes_cli.auth",
    "hermes_cli.commands",
    "hermes_cli.employee_auth",
    "hermes_cli.static_updater",
    "agent",
    "agent.mcp_publish",
    "agent.mcp_publish.server",
    "agent.mcp_intercept",
    "agent.mcp_intercept.server",
    "agent.mcp_wechat",
    "agent.mcp_wechat.server",
    "agent.mcp_crm",
    "agent.mcp_crm.server",
    "agent.mcp_browser",
    "agent.mcp_browser.cdp",
    "playwright",
    "playwright.async_api",
    "playwright._impl",
    "tools",
    "gateway.status",
    "plugins",
    "acp_adapter",
    "acp_adapter.entry",
    "run_agent",

    # PyArmor runtime support for obfuscated hermes_cli.license module.
    "pyarmor_runtime_000000",
    "pyarmor_runtime_000000.pyarmor_runtime",
]

# Include everything under hermes_cli / agent / tools / gateway / plugins
# that wouldn't otherwise be picked up by static analysis.
from PyInstaller.utils.hooks import collect_submodules, collect_data_files

for pkg in ("hermes_cli", "agent", "tools", "gateway", "plugins", "acp_adapter", "cron", "pyarmor_runtime_000000", "api"):
    try:
        hiddenimports.extend(collect_submodules(pkg))
    except Exception:
        pass

# Playwright — bundle the Python lib (NOT the Chromium binary; we use CDP
# to attach to the user's existing Chrome, saving ~150MB).
try:
    hiddenimports.extend(collect_submodules("playwright"))
    datas.extend(collect_data_files("playwright"))
except Exception:
    pass

# Top-level webui server module (imported as `import server` after we
# prepend webui/ to sys.path at runtime).
hiddenimports.append("server")

# ---------------------------------------------------------------------------
# Binaries collected from dependencies (FastAPI's uvloop, httptools, etc.).
# ---------------------------------------------------------------------------

binaries = []

# Bundle the PyArmor runtime .so so the obfuscated hermes_cli.license module
# can decrypt itself at launch.
pyarmor_so = HERMES_ROOT / "pyarmor_runtime_000000" / "pyarmor_runtime.so"
if pyarmor_so.is_file():
    binaries.append((str(pyarmor_so), "pyarmor_runtime_000000"))

# Carry the pyarmor_runtime_000000 package alongside (the __init__.py and .so
# must both ship for the runtime to register with __pyarmor__).
pyarmor_pkg_init = HERMES_ROOT / "pyarmor_runtime_000000" / "__init__.py"
if pyarmor_pkg_init.is_file():
    datas.append((str(pyarmor_pkg_init), "pyarmor_runtime_000000"))


# ---------------------------------------------------------------------------
# Runtime hooks — set HERMES_MANAGED before hermes_cli starts.
# ---------------------------------------------------------------------------

runtime_hooks = []


# ---------------------------------------------------------------------------
# Analysis / EXE / COLLECT / BUNDLE
# ---------------------------------------------------------------------------

a = Analysis(
    [str(HERMES_ROOT / "packaging" / "macos" / "app_launcher.py")],
    pathex=[str(HERMES_ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=runtime_hooks,
    excludes=[
        # Large optional extras we don't bundle in the desktop build.
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
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="netclaw-agent",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,  # windowed app — no Terminal on launch
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,  # respect host arch; for universal2 set "universal2"
    codesign_identity=None,  # signed in a later step by sign_notarize.sh
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="netclaw-agent",
)

app = BUNDLE(
    coll,
    name=f"{APP_NAME}.app",
    icon=str(HERMES_ROOT / "packaging" / "macos" / "icon" / "NetClawAgent.icns"),
    bundle_identifier=BUNDLE_ID,
    version=VERSION,
    info_plist={
        "CFBundleName": APP_NAME,
        "CFBundleDisplayName": APP_NAME,
        "CFBundleShortVersionString": VERSION,
        "CFBundleVersion": VERSION,
        "LSMinimumSystemVersion": "12.0",
        "NSHighResolutionCapable": True,
        "NSRequiresAquaSystemAppearance": False,
        "NSAppTransportSecurity": {
            "NSAllowsLocalNetworking": True,
        },
        "NSHumanReadableCopyright": "Copyright © 2026 NetClaw. MIT License.",
        "LSArchitecturePriority": ["arm64", "x86_64"],
    },
)
