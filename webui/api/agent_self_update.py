"""NetClaw Agent — installed-build self-update flow.

For PyInstaller + Inno Setup installs (Windows). On non-Windows or in dev
mode (no bundle.json present), every endpoint is a no-op returning
``{"available": false}``.

Flow:
    1. WebUI loads → calls GET /api/agent-update/check
    2. We forward to <license_server>/api/agent/version-check?current=...
    3. If the response says ``has_update: true`` → WebUI renders a banner
    4. User clicks "Update now" → POST /api/agent-update/apply
    5. Server downloads the .exe to ``%TEMP%`` (sha256-verified), launches
       Setup.exe with /SILENT /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS, and
       exits. Inno Setup closes the running NetClaw Agent, installs the
       new version in place, and restarts. User sees ~30s of "installing"
       dialog, then their session resumes.

Skipped scenarios (returns 200 with ``available: false``):
    * No bundle.json (generic build / dev mode)
    * Non-Windows host (.app bundle has its own update path TODO)
    * License-server unreachable (transient — we don't block)
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import platform
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def _agent_version() -> str:
    """Resolve the running build's semver from packaging metadata.

    Falls back to "0.0.0" when no version info is bundled — that signals
    "I don't know what I am" so the server treats this as an outdated
    install (any published version > 0.0.0).
    """
    try:
        from importlib.metadata import version as _mver

        return _mver("hermes-agent")
    except Exception:
        return os.environ.get("NETCLAW_AGENT_VERSION", "0.0.0")


def _bundle() -> dict | None:
    """Load bundle.json if present (only set in per-tenant installer builds)."""
    try:
        from hermes_cli import employee_auth

        path = employee_auth.bundle_path()
        if path is None or not path.is_file():
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.debug("bundle probe failed: %s", exc)
        return None


def _is_windows_installed() -> bool:
    if platform.system() != "Windows":
        return False
    return os.environ.get("NETCLAW_MANAGED") == "windows-installer"


# ---------------------------------------------------------------------------
# Cache: avoid hammering license-server on every page load
# ---------------------------------------------------------------------------

_check_cache: dict[str, Any] = {"at": 0.0, "result": None}
_check_lock = threading.Lock()
_CACHE_TTL = 600  # 10 min


def _cached_check() -> dict | None:
    with _check_lock:
        if (
            _check_cache["result"] is not None
            and time.time() - _check_cache["at"] < _CACHE_TTL
        ):
            return _check_cache["result"]
    return None


def _store_check(result: dict) -> None:
    with _check_lock:
        _check_cache["at"] = time.time()
        _check_cache["result"] = result


def _invalidate_cache() -> None:
    with _check_lock:
        _check_cache["at"] = 0.0
        _check_cache["result"] = None


# ---------------------------------------------------------------------------
# Public API: /api/agent-update/check
# ---------------------------------------------------------------------------


def check() -> dict:
    """Ask license-server whether a newer build is published."""
    if not _is_windows_installed():
        return {"available": False, "reason": "not_a_windows_installer_build"}
    bundle = _bundle()
    if not bundle:
        return {"available": False, "reason": "no_bundle_json"}
    license_server = bundle.get("license_server", "").rstrip("/")
    if not license_server:
        return {"available": False, "reason": "license_server_missing_in_bundle"}

    cached = _cached_check()
    if cached is not None:
        return cached

    current = _agent_version()
    url = f"{license_server}/api/agent/version-check?current={current}&channel=stable"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (
        urllib.error.URLError,
        urllib.error.HTTPError,
        OSError,
        json.JSONDecodeError,
    ) as exc:
        logger.warning("version-check failed: %s", exc)
        return {"available": False, "reason": f"server_error:{type(exc).__name__}"}

    if not payload.get("success"):
        return {"available": False, "reason": "server_returned_failure"}

    out = {
        "available": bool(payload.get("has_update")),
        "force": bool(payload.get("force")),
        "current": current,
        "latest": payload.get("latest") or {},
    }
    _store_check(out)
    return out


# ---------------------------------------------------------------------------
# Public API: /api/agent-update/apply
# ---------------------------------------------------------------------------


def _download_to_temp(url: str, expected_sha256: str, expected_size: int) -> Path:
    """Stream the new installer into %TEMP% and verify checksum.

    Raises RuntimeError on size mismatch / sha mismatch — we'd rather abort
    than launch a tampered installer.
    """
    temp_dir = Path(
        os.environ.get("TEMP")
        or os.environ.get("TMP")
        or Path.home() / "AppData" / "Local" / "Temp"
    )
    temp_dir.mkdir(parents=True, exist_ok=True)
    target = temp_dir / f"NetClaw-Agent-Update-{int(time.time())}.exe"

    sha = hashlib.sha256()
    bytes_seen = 0
    try:
        with urllib.request.urlopen(url, timeout=300) as resp, target.open("wb") as fh:
            while True:
                chunk = resp.read(64 * 1024)
                if not chunk:
                    break
                fh.write(chunk)
                sha.update(chunk)
                bytes_seen += len(chunk)
                if bytes_seen > expected_size + (16 * 1024 * 1024):
                    raise RuntimeError(
                        f"download exceeded expected size by >16 MB; aborting at {bytes_seen} bytes"
                    )
    except urllib.error.HTTPError as exc:
        target.unlink(missing_ok=True)
        raise RuntimeError(f"download HTTP {exc.code}: {exc.reason}") from exc
    except OSError as exc:
        target.unlink(missing_ok=True)
        raise RuntimeError(f"download IO error: {exc}") from exc

    if bytes_seen != expected_size:
        target.unlink(missing_ok=True)
        raise RuntimeError(
            f"size mismatch: downloaded {bytes_seen} bytes, expected {expected_size}"
        )
    actual = sha.hexdigest()
    if actual.lower() != expected_sha256.lower():
        target.unlink(missing_ok=True)
        raise RuntimeError(f"sha256 mismatch: got {actual}, expected {expected_sha256}")
    return target


def _launch_installer_then_exit(setup_path: Path) -> None:
    """Spawn the Inno Setup installer and disconnect, then exit ourselves.

    Inno Setup flags:
        /SILENT             — show install progress dialog but no prompts
        /CLOSEAPPLICATIONS  — auto-close running NetClaw before file replace
        /RESTARTAPPLICATIONS— relaunch NetClaw after successful install
        /NORESTART          — don't reboot Windows (we never need this)
    """
    args = [
        str(setup_path),
        "/SILENT",
        "/CLOSEAPPLICATIONS",
        "/RESTARTAPPLICATIONS",
        "/NORESTART",
    ]
    # DETACHED_PROCESS (Windows) so the installer keeps running after we exit.
    creationflags = 0x00000008 if platform.system() == "Windows" else 0
    subprocess.Popen(args, close_fds=True, creationflags=creationflags)
    # Give Inno a couple of seconds to spawn before we cut.
    time.sleep(2)
    # Hard exit so the installer's /CLOSEAPPLICATIONS handshake completes
    # (it sends WM_QUERYENDSESSION; if our process is hung, install hangs).
    os._exit(0)


def apply_update() -> dict:
    """Download + launch the new installer. Does not return on success
    (process exits via ``os._exit(0)``)."""
    if not _is_windows_installed():
        return {"ok": False, "error": "not_a_windows_installer_build"}

    state = check()
    if not state.get("available"):
        return {"ok": False, "error": "no_update_available", "state": state}
    latest = state["latest"]
    url = latest.get("download_url")
    sha = latest.get("sha256")
    size = latest.get("size_bytes")
    if not url or not sha or not size:
        return {"ok": False, "error": "incomplete_version_metadata", "state": state}

    try:
        setup = _download_to_temp(url, sha, size)
    except RuntimeError as exc:
        logger.error("download failed: %s", exc)
        return {"ok": False, "error": str(exc)}

    # Hand off in a background thread so this HTTP request returns 200
    # before we exit. The thread sleeps 1s then triggers exit.
    def _go() -> None:
        time.sleep(1)
        _launch_installer_then_exit(setup)

    threading.Thread(target=_go, name="netclaw-self-update", daemon=True).start()
    return {"ok": True, "downloaded_to": str(setup), "size": size}
