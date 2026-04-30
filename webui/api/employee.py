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
    return j(handler, _public_state(state))


def handle_login(handler, body: dict) -> bool:
    guard = _guard()
    if guard:
        return j(handler, guard, status=500)
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    if not username or not password:
        return bad(handler, "username and password are required")
    try:
        state = ea.login(username=username, password=password)
    except ea.EmployeeAuthError as err:
        return j(handler, {"error": str(err)}, status=400)
    except Exception as err:
        return j(handler, {"error": "login_failed", "detail": str(err)}, status=500)
    return j(handler, _public_state(state))


def handle_logout(handler, body: dict) -> bool:
    guard = _guard()
    if guard:
        return j(handler, guard, status=500)
    try:
        ea.logout()
    except Exception as err:
        return j(handler, {"error": "logout_failed", "detail": str(err)}, status=500)
    return j(handler, {"logged_in": False})
