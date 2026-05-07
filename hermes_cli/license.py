"""NetClaw Agent license client — activation, verification, offline grace.

Talks to the NetClaw License Server hosted at
``https://license.netclawsec.com.cn`` (override with ``NETCLAW_LICENSE_SERVER``).

State file layout at ``{NetClaw home}/license.json``::

    {
      "license_key": "NCLW-XXXXX-...",
      "token": "<JWT>",
      "fingerprint": "<sha256>",
      "plan": "pro",
      "seats": 3,
      "activated_at":   "2026-04-20T07:00:00Z",
      "last_verified_at":"2026-04-20T07:00:00Z",
      "license_expires_at": null
    }

Users never see the ``hermes_constants`` internals — only ``netclaw license``
subcommands and the ``~/.netclaw/`` directory.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import urllib.error
import urllib.request

from hermes_constants import get_hermes_home


DEFAULT_SERVER = "https://license.netclawsec.com.cn"
DEFAULT_OFFLINE_GRACE_DAYS = 7
REQUEST_TIMEOUT_SECONDS = 10
STATE_VERSION = 1


class LicenseError(RuntimeError):
    """User-visible license failure — message is printable directly."""


@dataclass
class LicenseState:
    license_key: str
    token: str
    fingerprint: str
    plan: str
    seats: int
    activated_at: str
    last_verified_at: str
    license_expires_at: Optional[str] = None


def _server_base() -> str:
    return os.getenv("NETCLAW_LICENSE_SERVER", DEFAULT_SERVER).rstrip("/")


def _offline_grace_seconds() -> int:
    try:
        days = int(
            os.getenv("NETCLAW_LICENSE_OFFLINE_DAYS", str(DEFAULT_OFFLINE_GRACE_DAYS))
        )
    except ValueError:
        days = DEFAULT_OFFLINE_GRACE_DAYS
    return max(0, days) * 86400


def _now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _parse_iso(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


def license_state_path() -> Path:
    return get_hermes_home() / "license.json"


def machine_fingerprint() -> str:
    """Stable per-host identifier — SHA256(hostname || MAC || machine arch).

    Uses ``uuid.getnode()`` which prefers a real MAC and falls back to a
    stable random value; combined with hostname and CPU arch this is specific
    enough for single-host seat binding without embedding the raw MAC.
    """
    parts = [
        platform.node() or "unknown-host",
        f"{uuid.getnode():x}",
        platform.machine() or "unknown-arch",
    ]
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def _post_json(
    url: str, payload: dict, *, timeout: int = REQUEST_TIMEOUT_SECONDS
) -> tuple[int, dict]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": f"netclaw-agent/{_app_version()}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as err:
        try:
            data = json.loads(err.read() or b"null")
        except Exception:
            data = {"error": f"http_{err.code}"}
        return err.code, data


def _app_version() -> str:
    # Deferred import: run_agent has heavy deps we don't need at license check time.
    try:
        from importlib.metadata import version

        return version("hermes-agent")
    except Exception:
        return "0.0.0"


def load_state() -> Optional[LicenseState]:
    path = license_state_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    try:
        return LicenseState(
            license_key=data["license_key"],
            token=data["token"],
            fingerprint=data["fingerprint"],
            plan=data.get("plan", "unknown"),
            seats=int(data.get("seats", 1)),
            activated_at=data.get("activated_at", _now_iso()),
            last_verified_at=data.get("last_verified_at", _now_iso()),
            license_expires_at=data.get("license_expires_at"),
        )
    except (KeyError, TypeError, ValueError):
        return None


def save_state(state: LicenseState) -> None:
    path = license_state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "_version": STATE_VERSION,
        "license_key": state.license_key,
        "token": state.token,
        "fingerprint": state.fingerprint,
        "plan": state.plan,
        "seats": state.seats,
        "activated_at": state.activated_at,
        "last_verified_at": state.last_verified_at,
        "license_expires_at": state.license_expires_at,
    }
    # Write through a temp file so a concurrent process can't read a half-written JSON.
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def clear_state() -> None:
    path = license_state_path()
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def activate(license_key: str) -> LicenseState:
    """Exchange a license key for an activation token and persist it."""
    fp = machine_fingerprint()
    status, body = _post_json(
        f"{_server_base()}/api/license/activate",
        {
            "license_key": license_key,
            "fingerprint": fp,
            "hostname": platform.node(),
            "platform": sys.platform,
            "app_version": _app_version(),
        },
    )
    if status != 200:
        raise LicenseError(_format_api_error("activation failed", status, body))
    token = body.get("token")
    license_info = body.get("license") or {}
    if not token:
        raise LicenseError("activation response missing token")
    now = _now_iso()
    state = LicenseState(
        license_key=license_key,
        token=token,
        fingerprint=fp,
        plan=license_info.get("plan", "unknown"),
        seats=int(license_info.get("seats", 1)),
        activated_at=now,
        last_verified_at=now,
        license_expires_at=license_info.get("expires_at"),
    )
    save_state(state)
    return state


def verify(
    state: Optional[LicenseState] = None, *, network: bool = True
) -> LicenseState:
    """Check the current activation against the server (if reachable).

    Updates ``last_verified_at`` on success. If the network call fails the
    cached state is returned provided the offline grace window is still open;
    otherwise :class:`LicenseError` is raised.
    """
    state = state or load_state()
    if state is None:
        raise LicenseError(
            "no license installed — run `netclaw license activate <key>`"
        )

    if not network:
        return state

    try:
        status, body = _post_json(
            f"{_server_base()}/api/license/verify",
            {"token": state.token, "fingerprint": state.fingerprint},
        )
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        # Network trouble — fall back to offline grace.
        last_seen = _parse_iso(state.last_verified_at)
        elapsed = (datetime.now(timezone.utc) - last_seen).total_seconds()
        if elapsed > _offline_grace_seconds():
            raise LicenseError(
                "license server unreachable and offline grace has expired — "
                "connect this machine to the internet and retry. "
                f"(details: {err})"
            ) from err
        return state

    if status == 200 and body.get("valid"):
        # Server accepted the token; refresh cached info.
        info = body.get("license") or {}
        state.plan = info.get("plan", state.plan)
        state.seats = int(info.get("seats", state.seats))
        state.license_expires_at = info.get("expires_at", state.license_expires_at)
        state.last_verified_at = _now_iso()
        save_state(state)
        return state

    # Server rejected the token — the failure is authoritative.
    raise LicenseError(_format_api_error("verification failed", status, body))


def deactivate() -> None:
    state = load_state()
    if state is None:
        return
    try:
        _post_json(
            f"{_server_base()}/api/license/deactivate",
            {"token": state.token, "fingerprint": state.fingerprint},
        )
    except (urllib.error.URLError, TimeoutError, OSError):
        # Server unreachable — local cleanup still happens.
        pass
    clear_state()


def enforce(*, network: bool = True) -> Optional[LicenseState]:
    """Block startup unless a valid license is present.

    Honors two escape hatches:

    * ``NETCLAW_LICENSE_SKIP=1`` — bypass entirely (dev / CI).
    * ``NETCLAW_LICENSE_OFFLINE=1`` — skip the network call this time.
    """
    if os.getenv("NETCLAW_LICENSE_SKIP") == "1":
        return None
    use_network = network and os.getenv("NETCLAW_LICENSE_OFFLINE") != "1"
    state = verify(network=use_network)
    return state


def describe(state: Optional[LicenseState] = None) -> dict[str, Any]:
    """Return a pretty-printable summary of the current license."""
    state = state or load_state()
    if state is None:
        return {"status": "unlicensed", "server": _server_base()}
    now = datetime.now(timezone.utc)
    last_seen = _parse_iso(state.last_verified_at)
    offline_age = (now - last_seen).total_seconds()
    grace = _offline_grace_seconds()
    return {
        "status": "active",
        "license_key": state.license_key,
        "plan": state.plan,
        "seats": state.seats,
        "fingerprint": state.fingerprint,
        "activated_at": state.activated_at,
        "last_verified_at": state.last_verified_at,
        "license_expires_at": state.license_expires_at,
        "offline_age_seconds": int(offline_age),
        "offline_grace_seconds": grace,
        "within_offline_grace": offline_age <= grace,
        "server": _server_base(),
    }


def _format_api_error(prefix: str, status: int, body: dict) -> str:
    err = body.get("error") if isinstance(body, dict) else None
    hints = {
        "license_not_found": "the key is not recognized — double-check for typos",
        "license_revoked": "this license has been revoked by the issuer",
        "license_expired": "this license has expired — contact sales for renewal",
        "seats_full": "all seats are currently in use — deactivate another machine first",
        "fingerprint_mismatch": "this machine's fingerprint does not match the activation — re-activate with `netclaw license activate <key>`",
        "activation_deactivated": "this seat was deactivated — re-activate with `netclaw license activate <key>`",
        "invalid_token": "the stored token is invalid — re-activate with `netclaw license activate <key>`",
        "missing_bearer": "server refused the request (missing auth)",
        "invalid_bearer": "server refused the request (invalid auth)",
        "invalid_body": "server rejected the request body format",
        "server_misconfigured": "the license server is misconfigured — notify support",
    }
    hint = hints.get(err, err or f"http {status}")
    return f"{prefix}: {hint}"


# ---------------------------------------------------------------------------
# CLI entry points — wired into hermes_cli.main via the `license` subcommand.
# ---------------------------------------------------------------------------


def cmd_activate(args) -> int:
    try:
        state = activate(args.key.strip())
    except LicenseError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    print(f"activated — plan={state.plan} seats={state.seats}")
    if state.license_expires_at:
        print(f"license expires at: {state.license_expires_at}")
    print(f"token stored at: {license_state_path()}")
    return 0


def cmd_status(args) -> int:
    info = describe()
    if args.json:
        print(json.dumps(info, indent=2))
        return 0
    if info["status"] == "unlicensed":
        print("no license installed. Run:  netclaw license activate <LICENSE-KEY>")
        print(f"server: {info['server']}")
        return 1
    print(f"status            : {info['status']}")
    print(f"license key       : {info['license_key']}")
    print(f"plan              : {info['plan']}  (seats: {info['seats']})")
    print(f"activated at      : {info['activated_at']}")
    print(f"last verified at  : {info['last_verified_at']}")
    if info.get("license_expires_at"):
        print(f"license expires at: {info['license_expires_at']}")
    print(
        f"offline grace     : {info['offline_age_seconds']}s / {info['offline_grace_seconds']}s "
        f"(within grace: {info['within_offline_grace']})"
    )
    print(f"server            : {info['server']}")
    return 0


def cmd_verify(args) -> int:
    try:
        state = verify(network=True)
    except LicenseError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    print(f"ok — plan={state.plan} last_verified_at={state.last_verified_at}")
    return 0


def cmd_deactivate(args) -> int:
    if load_state() is None:
        print("nothing to do — no license installed")
        return 0
    deactivate()
    print("license deactivated and local state cleared")
    return 0


def register_subparser(subparsers) -> None:
    """Attach the `license` command tree to an argparse subparsers object."""
    parser = subparsers.add_parser(
        "license",
        help="Manage your NetClaw Agent license",
        description="Activate, verify and deactivate your NetClaw Agent license.",
    )
    sub = parser.add_subparsers(dest="license_command", required=True)

    p_act = sub.add_parser("activate", help="Activate this machine with a license key")
    p_act.add_argument("key", help="License key, e.g. NCLW-XXXXX-XXXXX-XXXXX-XXXXX")
    p_act.set_defaults(func=cmd_activate)

    p_stat = sub.add_parser("status", help="Show current license status")
    p_stat.add_argument("--json", action="store_true", help="Emit JSON")
    p_stat.set_defaults(func=cmd_status)

    p_ver = sub.add_parser(
        "verify", help="Force a live verification against the server"
    )
    p_ver.set_defaults(func=cmd_verify)

    p_deact = sub.add_parser(
        "deactivate", help="Release this machine's seat and clear local state"
    )
    p_deact.set_defaults(func=cmd_deactivate)
