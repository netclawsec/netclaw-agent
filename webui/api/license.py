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
