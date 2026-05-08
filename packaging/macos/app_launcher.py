"""
NetClaw Agent — macOS .app launcher.

Double-clicking NetClaw Agent.app runs this script via PyInstaller's bootloader.

Flow:
    1. Spawn uvicorn in a background thread (127.0.0.1:9119, no browser auto-open).
    2. Wait for the port to accept connections (up to 15s).
    3. Open a pywebview window pointing at http://127.0.0.1:9119.
    4. When the user closes the window, force-exit so uvicorn's daemon thread dies.

Environment:
    HERMES_BUNDLED_SKILLS points at the skills/ dir inside the app bundle.
    HERMES_OPTIONAL_SKILLS points at optional-skills/.
    HERMES_MANAGED="macos-app" identifies this install so `hermes update` can
    show the right guidance (re-download DMG instead of pip upgrade).
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
from pathlib import Path


def _frozen_resource_dir() -> Path:
    """Return the Resources/ dir inside Hermes.app/Contents/.

    PyInstaller sets sys._MEIPASS to the unpacked resource dir at runtime.
    In development (`python app_launcher.py`) this falls back to the repo root.
    """
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass)
    return Path(__file__).resolve().parent.parent.parent


def _setup_environment() -> None:
    """Set env vars before importing hermes_cli modules."""
    resources = _frozen_resource_dir()

    skills_dir = resources / "skills"
    optional_skills_dir = resources / "optional-skills"

    if skills_dir.is_dir():
        os.environ.setdefault("HERMES_BUNDLED_SKILLS", str(skills_dir))
    if optional_skills_dir.is_dir():
        os.environ.setdefault("HERMES_OPTIONAL_SKILLS", str(optional_skills_dir))

    os.environ.setdefault("HERMES_MANAGED", "macos-app")


def _wait_for_port(host: str, port: int, timeout: float = 15.0) -> bool:
    """Block until the server accepts TCP connections or timeout elapses."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except (OSError, ConnectionRefusedError):
            time.sleep(0.1)
    return False


def _start_server_thread(host: str, port: int) -> threading.Thread:
    """Start the NetClaw WebUI server (webui/server.py) in a daemon thread.

    webui/server.py uses ``from api.X import ...`` (top-level relative to
    webui/), so we prepend the bundled webui/ to sys.path before importing.
    """
    os.environ["HERMES_WEBUI_HOST"] = host
    os.environ["HERMES_WEBUI_PORT"] = str(port)
    resources = _frozen_resource_dir()
    os.environ["HERMES_WEBUI_AGENT_DIR"] = str(resources)
    os.environ["HERMES_WEBUI_PYTHON"] = sys.executable

    webui_dir = resources / "webui"
    if str(webui_dir) not in sys.path:
        sys.path.insert(0, str(webui_dir))

    def _run() -> None:
        try:
            # Short-circuit webui's hermes-agent dep check + auto-install:
            # everything's already bundled, no pip needed at runtime.
            from api import config as _cfg
            from api import startup as _startup

            _cfg.verify_hermes_imports = lambda: (True, [], {})
            _startup.auto_install_agent_deps = lambda: True

            import server  # webui/server.py

            server.main()
        except SystemExit:
            pass
        except Exception as exc:  # pragma: no cover
            print(f"[netclaw] webui server crashed: {exc}", file=sys.stderr)

    thread = threading.Thread(target=_run, name="netclaw-webui", daemon=True)
    thread.start()
    return thread


def main() -> int:
    _setup_environment()

    host = os.environ.get("HERMES_APP_HOST", "127.0.0.1")
    port = int(os.environ.get("HERMES_APP_PORT", "9119"))

    _start_server_thread(host, port)

    if not _wait_for_port(host, port, timeout=20.0):
        _show_startup_error(
            "NetClaw Agent failed to start",
            f"The local web server at {host}:{port} did not come up within 20 s.\n"
            "Check Console.app logs under 'Hermes' for details.",
        )
        return 1

    url = f"http://{host}:{port}"

    try:
        import webview  # pywebview
    except ImportError:
        _show_startup_error(
            "Missing dependency",
            "pywebview is not bundled. Reinstall NetClaw Agent from the DMG.",
        )
        return 1

    # JS bridge — exposes Python-callable methods to the SPA via
    # window.pywebview.api.<method>(...). The "打开管理后台" button calls
    # `open_external(url)` which spawns the system default browser, since
    # window.open(url) inside pywebview is a no-op for non-allow-listed
    # cross-origin URLs.
    class _PyApi:
        def open_external(self, url: str) -> bool:
            import webbrowser

            if not isinstance(url, str) or not url.startswith(("http://", "https://")):
                return False
            try:
                webbrowser.open(url, new=2)
                return True
            except Exception:
                return False

    webview.create_window(
        "NetClaw Agent",
        url,
        width=1280,
        height=860,
        min_size=(900, 640),
        maximized=True,
        resizable=True,
        confirm_close=False,
        js_api=_PyApi(),
    )
    webview.start(gui="cocoa", debug=False)

    os._exit(0)


def _show_startup_error(title: str, message: str) -> None:
    """Show a native alert. Falls back to stderr if AppKit unavailable."""
    try:
        from AppKit import NSAlert, NSApplication

        NSApplication.sharedApplication()
        alert = NSAlert.alloc().init()
        alert.setMessageText_(title)
        alert.setInformativeText_(message)
        alert.runModal()
    except Exception:
        print(f"[hermes] {title}: {message}", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
