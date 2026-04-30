"""NetClaw Agent — Windows GUI launcher (.exe windowed, no console).

Double-clicking ``NetClaw Agent.exe`` runs this script. Mirrors the macOS
flow:
    1. Set bundled-skills env vars + force UTF-8 IO.
    2. Spawn uvicorn in a daemon thread (127.0.0.1:9119, no auto-browser).
    3. Wait for the port to come up.
    4. Open a pywebview native window pointing at the local server.
    5. When the window closes, force-exit so the daemon thread dies too.

The CLI binary (``netclaw.exe``) shares the same _internal/ deps but uses
``launcher.py`` as its entry — so power users can still
``netclaw license activate ...`` from a regular CMD prompt.
"""

from __future__ import annotations

import ctypes
import os
import socket
import sys
import threading
import time
import traceback
from pathlib import Path


def _log_path() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".netclaw")
    log_dir = base / "NetClaw" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / "gui-launcher.log"


def _log(msg: str) -> None:
    try:
        with _log_path().open("a", encoding="utf-8") as fh:
            ts = time.strftime("%Y-%m-%d %H:%M:%S")
            fh.write(f"[{ts}] {msg}\n")
    except Exception:
        pass


def _redirect_stdio_to_log() -> None:
    """In windowed mode, sys.stdout/err are closed. Re-open to a log file
    so any uvicorn / hermes_cli print() doesn't crash with WinError 6."""
    try:
        log_handle = _log_path().open("a", encoding="utf-8", buffering=1)
        sys.stdout = log_handle
        sys.stderr = log_handle
    except Exception:
        pass


def _frozen_resource_dir() -> Path:
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass)
    return Path(__file__).resolve().parent.parent.parent


def _setup_environment() -> None:
    resources = _frozen_resource_dir()
    skills_dir = resources / "skills"
    optional_skills_dir = resources / "optional-skills"
    if skills_dir.is_dir():
        os.environ.setdefault("HERMES_BUNDLED_SKILLS", str(skills_dir))
    if optional_skills_dir.is_dir():
        os.environ.setdefault("HERMES_OPTIONAL_SKILLS", str(optional_skills_dir))
    os.environ.setdefault("NETCLAW_MANAGED", "windows-installer")
    os.environ.setdefault("HERMES_MANAGED", "windows-installer")
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")


def _wait_for_port(host: str, port: int, timeout: float = 25.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.15)
    return False


def _start_server_thread(host: str, port: int) -> threading.Thread:
    """Start the NetClaw WebUI server (webui/server.py) in a daemon thread.

    Note: webui/server.py uses ``from api.X import ...`` (top-level api package
    relative to webui/), so we prepend the bundled webui/ dir to sys.path
    *before* importing.
    """
    os.environ["HERMES_WEBUI_HOST"] = host
    os.environ["HERMES_WEBUI_PORT"] = str(port)
    # Point webui at the bundled agent code so it doesn't try to spawn a
    # separate venv (run_agent.py is on _MEIPASS root).
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
        except Exception as exc:
            _log(f"webui server crashed: {exc}\n{traceback.format_exc()}")
            _show_error("NetClaw Agent — Server crashed", str(exc))

    thread = threading.Thread(target=_run, name="netclaw-webui", daemon=True)
    thread.start()
    return thread


def _show_error(title: str, message: str) -> None:
    """Native MessageBox; falls back to stderr on non-Win or missing user32."""
    try:
        if os.name == "nt":
            ctypes.windll.user32.MessageBoxW(0, message, title, 0x10)
            return
    except Exception:
        pass
    print(f"[netclaw] {title}: {message}", file=sys.stderr)


# Module-global so the kernel mutex handle survives until process exit
# (closing it before exit releases the lock for other instances).
_SINGLETON_HANDLE: int | None = None


def _acquire_single_instance_lock() -> bool:
    """Try to acquire a per-session named mutex.

    Returns ``True`` if this process is the only running instance, ``False``
    if another instance already holds the lock. Fail-open on non-Windows or
    if the Win32 call itself fails — never block startup over a diagnostic
    helper.
    """
    if os.name != "nt":
        return True
    try:
        kernel32 = ctypes.windll.kernel32
        # Local\ prefix scopes the mutex to the current logon session, so two
        # different Windows users on the same box can each run one instance.
        mutex_name = "Local\\NetClawAgent.Singleton.GUI"
        handle = kernel32.CreateMutexW(None, True, mutex_name)
        if not handle:
            return True
        ERROR_ALREADY_EXISTS = 183
        if kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
            kernel32.CloseHandle(handle)
            return False
        global _SINGLETON_HANDLE
        _SINGLETON_HANDLE = handle
        return True
    except Exception:
        return True


def _activate_existing_window() -> bool:
    """Best-effort: find the existing NetClaw Agent window and bring it forward."""
    if os.name != "nt":
        return False
    try:
        user32 = ctypes.windll.user32
        hwnd = user32.FindWindowW(None, "NetClaw Agent")
        if not hwnd:
            return False
        SW_RESTORE = 9
        user32.ShowWindow(hwnd, SW_RESTORE)
        user32.SetForegroundWindow(hwnd)
        return True
    except Exception:
        return False


def main() -> int:
    _redirect_stdio_to_log()
    _log("=" * 60)
    _log(f"NetClaw Agent GUI launcher starting (pid {os.getpid()})")
    _log(
        f"frozen={getattr(sys, 'frozen', False)}, _MEIPASS={getattr(sys, '_MEIPASS', None)}"
    )

    if not _acquire_single_instance_lock():
        _log(
            "another instance already holds the singleton lock; activating it and exiting"
        )
        activated = _activate_existing_window()
        _log(f"activated existing window: {activated}")
        return 0

    _setup_environment()
    host = os.environ.get("NETCLAW_APP_HOST", "127.0.0.1")
    port = int(os.environ.get("NETCLAW_APP_PORT", "9119"))
    _log(f"target: http://{host}:{port}")

    try:
        _start_server_thread(host, port)
    except Exception as exc:
        _log(f"start_server_thread failed: {exc}\n{traceback.format_exc()}")
        _show_error("NetClaw Agent — server import failed", str(exc))
        return 1

    if not _wait_for_port(host, port, timeout=25.0):
        _log(f"port {port} never came up")
        _show_error(
            "NetClaw Agent failed to start",
            f"Local web server at {host}:{port} did not come up within 25s.\n"
            f"See log: {_log_path()}",
        )
        return 1
    _log("port up; opening webview")

    # Per-company installer flow: if bundle.json is present and the user
    # isn't logged in (or session is expired), point the webview at the
    # employee-auth wizard instead of the root WebUI. The wizard redirects
    # to "/" once register/login succeeds. Generic builds (no bundle.json)
    # skip this entirely and keep using the legacy NCLW activation flow.
    landing_path = ""
    try:
        from hermes_cli import employee_auth as _ea

        if _ea.bundle_path() is not None:
            try:
                state = _ea.load_auth_state()
            except Exception:
                state = None
            if state is None or state.is_expired():
                landing_path = "/static/employee-auth.html"
                _log("bundle.json present + no valid session → routing to wizard")
    except Exception as exc:
        _log(f"bundle/auth probe failed (continuing with root UI): {exc}")

    url = f"http://{host}:{port}{landing_path}"
    try:
        import webview

        _log(
            f"webview imported: {webview.__version__ if hasattr(webview, '__version__') else 'unknown'}"
        )
    except ImportError as exc:
        _log(f"webview import failed: {exc}\n{traceback.format_exc()}")
        _show_error(
            "Missing dependency",
            f"pywebview is not bundled in this build.\n{exc}",
        )
        return 1

    try:
        webview.create_window(
            "NetClaw Agent",
            url,
            width=1280,
            height=860,
            min_size=(900, 640),
            resizable=True,
            confirm_close=False,
        )
        _log("create_window ok; calling webview.start()")
        webview.start(debug=False)
        _log("webview.start returned (window closed)")
        os._exit(0)
    except Exception as exc:
        _log(f"webview crashed: {exc}\n{traceback.format_exc()}")
        # Fall back to default browser. If WebView2 isn't available (rare on
        # Win10 19041+ but possible on older builds), at least the user gets
        # the WebUI in Edge/Chrome.
        _log("falling back to default browser")
        try:
            import webbrowser

            webbrowser.open(url)
        except Exception as bex:
            _log(f"webbrowser.open also failed: {bex}")
            _show_error(
                "NetClaw Agent — UI failed",
                f"Could not open WebUI:\n{exc}\n\nManually visit:\n  {url}",
            )
            return 1
        # Keep the process alive so uvicorn keeps serving.
        # User stops by closing the browser tab + killing via Task Manager,
        # OR by running 'netclaw stop' (if implemented) from CMD.
        _log(
            "server running in background; close this process via Task Manager to stop"
        )
        try:
            while True:
                time.sleep(60)
        except KeyboardInterrupt:
            pass
        os._exit(0)


if __name__ == "__main__":
    sys.exit(main())
