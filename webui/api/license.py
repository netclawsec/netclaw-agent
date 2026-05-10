"""WebUI license endpoints — thin wrapper around hermes_cli.license.

Exposes:
  GET  /api/license                -> current license state (describe)
  POST /api/license/activate       -> exchange a key for a seat + token
  POST /api/license/deactivate     -> release this machine's seat
  POST /api/license/verify         -> force online re-verify

All mutation endpoints touch ``~/.netclaw/license.json`` (or hermes_home
equivalent), so they should be treated as authenticated admin-grade calls
when the WebUI auth layer is enabled. The existing CSRF guard in routes.py
covers browser-origin checks.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from api.helpers import bad, j

try:  # license module lives in the CLI package
    from hermes_cli import license as _license
except Exception as exc:  # pragma: no cover — surface to caller as a 500
    _license = None
    _import_error = exc
else:
    _import_error = None

try:
    from hermes_cli import employee_auth as _ea
except Exception:  # pragma: no cover
    _ea = None


def _employee_license_view() -> dict[str, Any] | None:
    """If this machine has a valid employee login, ask the license server
    whether the employee's tenant has any active license issued.

    NetClaw has two activation paths: single-machine NCLW keys (license.json)
    and multi-tenant employee JWTs (auth.json). The agent now hits
    ``/api/employee/me`` (which returns ``tenant_license: {active, plan,
    seats, expires_at}``) so AccountPage can answer the right question:
    "did the operator issue a license to this tenant in the admin UI?"
    """
    if _ea is None:
        return None
    try:
        state = _ea.load_auth_state()
    except Exception:
        return None
    if state is None or state.is_expired():
        return None

    import json as _json
    import urllib.request as _ur
    import urllib.error as _ue

    server = (state.server or "").rstrip("/")
    if not server:
        return None
    try:
        req = _ur.Request(
            f"{server}/api/employee/me",
            headers={
                "Authorization": f"Bearer {state.token}",
                "User-Agent": "netclaw-agent",
                "Accept": "application/json",
            },
        )
        with _ur.urlopen(req, timeout=10) as resp:
            body = _json.loads(resp.read() or b"{}")
    except (_ue.URLError, TimeoutError, OSError, ValueError):
        return None
    if not body.get("success"):
        return None

    lic = body.get("tenant_license") or {}
    tenant = body.get("tenant") or {}
    plan = lic.get("plan") or tenant.get("name") or state.tenant_id or "tenant"
    expires = lic.get("expires_at") or state.expires_at
    return {
        "status": "active" if lic.get("active") else "unlicensed",
        "active": bool(lic.get("active")),
        "plan": plan,
        "seats": int(lic.get("seats") or 1),
        "license_key": lic.get("license_key") or f"employee:{state.username}",
        "fingerprint": state.machine_fingerprint,
        "activated_at": getattr(state, "refreshed_at", None) or state.expires_at,
        "last_verified_at": getattr(state, "refreshed_at", None) or state.expires_at,
        "license_expires_at": expires,
        "expires_at": expires,
        "days_remaining": _days_remaining(expires),
        "server": state.server,
        "source": "employee",
        "tenant_name": tenant.get("name"),
        "tenant_slug": tenant.get("slug"),
    }


def _days_remaining(expires_iso: str | None) -> int | None:
    if not expires_iso or not isinstance(expires_iso, str):
        return None
    text = expires_iso.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except Exception:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int((parsed - datetime.now(timezone.utc)).total_seconds() // 86400)


def _payload_from_state() -> dict[str, Any]:
    info = _license.describe()
    info["days_remaining"] = _days_remaining(info.get("license_expires_at"))
    # Frontend (AccountPage.tsx) reads `active` as a boolean. The CLI's
    # describe() only returns a `status` string ("active" / "unlicensed"),
    # so without this projection the UI always rendered 未激活 even when
    # the license was healthy. Also normalise the expiry alias the UI uses.
    info["active"] = info.get("status") == "active"
    if "license_expires_at" in info and "expires_at" not in info:
        info["expires_at"] = info.get("license_expires_at")
    info.setdefault("source", "license_key")
    # If no NCLW key is installed, fall back to the employee bundle —
    # multi-tenant deployments do not need a separate license activation.
    if not info.get("active"):
        emp = _employee_license_view()
        if emp is not None:
            return emp
    return info


def _guard():
    if _license is None:
        return {"error": "license_module_unavailable", "detail": str(_import_error)}
    return None


def handle_status(handler) -> bool:
    guard = _guard()
    if guard:
        return j(handler, guard, status=500)
    try:
        return j(handler, _payload_from_state())
    except Exception as err:
        return j(
            handler, {"error": "license_read_failed", "detail": str(err)}, status=500
        )


def handle_activate(handler, body: dict) -> bool:
    guard = _guard()
    if guard:
        return j(handler, guard, status=500)
    key = (body.get("license_key") or body.get("key") or "").strip()
    if not key:
        return bad(handler, "license_key is required")
    try:
        _license.activate(key)
    except _license.LicenseError as err:
        return j(handler, {"error": str(err)}, status=400)
    except Exception as err:
        return j(
            handler, {"error": "activation_failed", "detail": str(err)}, status=500
        )
    return j(handler, _payload_from_state())


def handle_deactivate(handler, body: dict) -> bool:
    guard = _guard()
    if guard:
        return j(handler, guard, status=500)
    try:
        _license.deactivate()
    except Exception as err:
        return j(
            handler, {"error": "deactivation_failed", "detail": str(err)}, status=500
        )
    return j(handler, {"status": "unlicensed"})


def handle_verify(handler, body: dict) -> bool:
    guard = _guard()
    if guard:
        return j(handler, guard, status=500)
    try:
        _license.verify(network=True)
    except _license.LicenseError as err:
        return j(handler, {"error": str(err)}, status=400)
    except Exception as err:
        return j(handler, {"error": "verify_failed", "detail": str(err)}, status=500)
    return j(handler, _payload_from_state())
