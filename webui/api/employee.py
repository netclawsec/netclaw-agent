"""WebUI employee-auth endpoints — thin wrapper around hermes_cli.employee_auth.

Exposes:
  GET  /api/bundle               -> bundle.json contents (sanitized — no signature) for the wizard
  GET  /api/employee/whoami      -> current logged-in employee from ~/.netclaw/auth.json
  POST /api/employee/register    -> consume invite_code → write auth.json
  POST /api/employee/login       -> username + password → write auth.json
  POST /api/employee/logout      -> clear auth.json + best-effort revoke server-side

The Python module already speaks to the License Server via HTTPS; the
browser hits this WebUI layer to keep the JWT off the renderer process.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from api.helpers import bad, j

try:
    from hermes_cli import employee_auth as ea
except Exception as exc:  # pragma: no cover
    ea = None
    _import_error: Exception | None = exc
else:
    _import_error = None


def _guard():
    if ea is None:
        return {"error": "employee_auth_unavailable", "detail": str(_import_error)}
    return None


def _public_state(state) -> dict[str, Any]:
    if state is None:
        return {"logged_in": False}
    return {
        "logged_in": True,
        "employee": {
            "id": state.employee_id,
            "username": state.username,
            "display_name": state.display_name,
            "tenant_id": state.tenant_id,
            "department_id": state.department_id,
            "department_name": state.department_name,
            "department_abbrev": state.department_abbrev,
        },
        "expires_at": state.expires_at,
        "server": state.server,
    }


def _public_bundle(bundle) -> dict[str, Any]:
    if bundle is None:
        return {"present": False}
    return {
        "present": True,
        "tenant_id": bundle.tenant_id,
        "tenant_slug": bundle.tenant_slug,
        "tenant_name": bundle.tenant_name,
        "license_server": bundle.license_server,
        "require_invite_code": bundle.require_invite_code,
        # Only expose active departments to the browser — the wizard's only
        # legitimate use is "pick the dept this invite belongs to".
        "departments": [
            {"id": d.get("id"), "name": d.get("name"), "abbrev": d.get("abbrev")}
            for d in bundle.departments
            if d.get("status", "active") == "active"
        ],
        "built_at": bundle.built_at,
    }


def _reset_employee_storage_cache() -> None:
    from api.config import LOCK, SESSIONS, SESSION_DIR, STATE_DIR

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    with LOCK:
        SESSIONS.clear()


def handle_bundle(handler) -> bool:
    guard = _guard()
    if guard:
        return j(handler, guard, status=500)
    try:
        bundle = ea.load_bundle()
    except ea.EmployeeAuthError as err:
        return j(handler, {"error": "bundle_invalid", "detail": str(err)}, status=500)
    return j(handler, _public_bundle(bundle))


def handle_whoami(handler) -> bool:
    guard = _guard()
    if guard:
        return j(handler, guard, status=500)
    try:
        state = ea.load_auth_state()
    except Exception as err:
        return j(handler, {"error": "auth_read_failed", "detail": str(err)}, status=500)
    return j(handler, _public_state(state))


def handle_resolve_invite(handler, body: dict) -> bool:
    """Resolve an invite code → tenant config; persist to ``tenant.json``.

    Used by the universal-binary onboarding wizard so a single .exe can be
    pointed at any tenant at runtime. The license server is read from
    ``NETCLAW_LICENSE_SERVER`` env var, then any pre-existing bundle, then
    the compiled-in DEFAULT_SERVER.
    """
    guard = _guard()
    if guard:
        return j(handler, guard, status=500)
    code = (body.get("code") or body.get("invite_code") or "").strip()
    if not code:
        return bad(handler, "invite code is required")
    server = ea.server_base(ea.load_bundle())
    try:
        bundle = ea.fetch_tenant_by_invite(server, code)
    except ea.EmployeeAuthError as err:
        return j(handler, {"error": str(err)}, status=400)
    except Exception as err:  # pragma: no cover — unexpected transport error
        return j(handler, {"error": "resolve_failed", "detail": str(err)}, status=500)
    try:
        ea.save_tenant_json(bundle)
    except OSError as err:
        return j(handler, {"error": "save_failed", "detail": str(err)}, status=500)
    return j(handler, _public_bundle(bundle))


def handle_register(handler, body: dict) -> bool:
    guard = _guard()
    if guard:
        return j(handler, guard, status=500)
    invite_code = (body.get("invite_code") or "").strip()
    raw_username = (body.get("raw_username") or "").strip()
    password = body.get("password") or ""
    if not invite_code or not raw_username or not password:
        return bad(handler, "invite_code, raw_username, password are required")
    try:
        state = ea.register(
            invite_code=invite_code,
            raw_username=raw_username,
            password=password,
        )
    except ea.EmployeeAuthError as err:
        return j(handler, {"error": str(err)}, status=400)
    except Exception as err:
        return j(handler, {"error": "register_failed", "detail": str(err)}, status=500)
    _reset_employee_storage_cache()
    return j(handler, _public_state(state))


def handle_login(handler, body: dict) -> bool:
    guard = _guard()
    if guard:
        return j(handler, guard, status=500)
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    organization = (body.get("organization") or "").strip()
    if not username or not password:
        return bad(handler, "username and password are required")
    try:
        state = ea.login(
            username=username,
            password=password,
            tenant_slug=organization or None,
        )
    except ea.EmployeeAuthError as err:
        return j(handler, {"error": str(err)}, status=400)
    except Exception as err:
        return j(handler, {"error": "login_failed", "detail": str(err)}, status=500)
    _reset_employee_storage_cache()
    return j(handler, _public_state(state))


def handle_logout(handler, body: dict) -> bool:
    guard = _guard()
    if guard:
        return j(handler, guard, status=500)
    try:
        ea.logout()
    except Exception as err:
        return j(handler, {"error": "logout_failed", "detail": str(err)}, status=500)
    _reset_employee_storage_cache()
    return j(handler, {"logged_in": False})


def _current_static_bundle_version() -> str:
    try:
        value = (Path.home() / ".netclaw" / "static-bundle.version").read_text(
            encoding="utf-8"
        )
        version = value.splitlines()[0].strip()
        if version:
            return version
    except (IndexError, OSError):
        pass
    try:
        from hermes_cli import static_updater

        return static_updater.current_version()
    except Exception:
        return "0.0.0"


def _license_server_url() -> str:
    if ea is None:
        return ""
    try:
        return ea.server_base(ea.load_bundle()).rstrip("/")
    except Exception:
        try:
            return ea.server_base(None).rstrip("/")
        except Exception:
            return ""


def handle_agent_version_info(handler) -> bool:
    return j(
        handler,
        {
            "current_version": _current_static_bundle_version(),
            "license_server": _license_server_url(),
        },
    )


def handle_agent_restart(handler) -> bool:
    """Schedule a self-restart of the NetClaw Agent process.

    Spawns a small shell script that waits 1s, kills the current process
    group, then relaunches the .app via ``open``. Works on macOS; on Windows
    the same script needs adapting (taskkill + start) — TODO for v0.12.x.
    """
    import os as _os
    import subprocess as _subp
    import sys as _sys
    import tempfile as _tempfile

    if _sys.platform == "darwin":
        # Find the .app root by walking up from the running executable.
        # exe path is typically /Applications/NetClaw Agent.app/Contents/MacOS/netclaw-agent
        exe = _sys.executable
        app_root = exe
        for _ in range(4):
            app_root = _os.path.dirname(app_root)
            if app_root.endswith(".app"):
                break
        if not app_root.endswith(".app"):
            return j(
                handler, {"success": False, "error": "app_path_not_found"}, status=500
            )
        pid = _os.getpid()
        script = (
            "#!/bin/bash\n"
            "sleep 1\n"
            f"kill {pid} 2>/dev/null\n"
            "sleep 1\n"
            f"open {repr(app_root)}\n"
        )
        with _tempfile.NamedTemporaryFile(
            "w", suffix=".sh", delete=False, prefix="netclaw-restart-"
        ) as fh:
            fh.write(script)
            script_path = fh.name
        _os.chmod(script_path, 0o755)
        _subp.Popen(
            ["/bin/bash", script_path],
            stdin=_subp.DEVNULL,
            stdout=_subp.DEVNULL,
            stderr=_subp.DEVNULL,
        )
        return j(handler, {"success": True, "scheduled_in_seconds": 2})

    if _sys.platform == "win32":
        # Windows: spawn cmd.exe with timeout + taskkill + start
        return j(
            handler,
            {"success": False, "error": "windows_restart_not_implemented"},
            status=501,
        )

    return j(
        handler,
        {"success": False, "error": "unsupported_platform"},
        status=501,
    )


def handle_agent_check_update(handler) -> bool:
    """Server-side proxy for license-server static-bundle-check (avoids browser CORS).

    Agent calls this; we hit the upstream and return the result.
    """
    server = _license_server_url()
    if not server:
        return j(handler, {"success": False, "error": "no_license_server"}, status=200)
    current = _current_static_bundle_version()
    url = (
        f"{server}/api/agent/static-bundle-check?current="
        f"{urllib.parse.quote(current)}&channel=stable"
    )
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads((resp.read() or b"null").decode("utf-8") or "null")
        return j(handler, {"current_version": current, **(data or {})})
    except urllib.error.URLError as err:
        return j(
            handler,
            {"success": False, "error": "upstream_unreachable", "detail": str(err)},
            status=200,
        )
    except Exception as err:
        return j(
            handler,
            {"success": False, "error": "check_failed", "detail": str(err)},
            status=500,
        )


def handle_agent_static_update_apply(handler, body: dict) -> bool:
    latest = body.get("latest") if isinstance(body, dict) else None
    if not isinstance(latest, dict):
        return bad(handler, "latest is required")
    version = str(latest.get("version") or "").strip()
    if not version:
        return bad(handler, "latest.version is required")

    license_server = str((body or {}).get("license_server") or "").strip().rstrip("/")
    if not license_server:
        license_server = _license_server_url()
    if not license_server:
        return j(
            handler,
            {"success": False, "version": version, "error": "license_server_missing"},
        )

    try:
        from hermes_cli import static_updater

        success = bool(static_updater.download_and_apply(latest, license_server))
    except Exception as err:
        return j(
            handler,
            {"success": False, "version": version, "error": str(err)},
        )

    result: dict[str, Any] = {"success": success, "version": version}
    if not success:
        result["error"] = "download_or_apply_failed"
    return j(handler, result)
