"""NetClaw Agent — multi-tenant employee auth client.

Sits next to ``license.py`` (single-machine NCLW key flow) but speaks the
multi-tenant employee API on the License Server:

  POST /api/employee/register     — invite-code → JWT
  POST /api/employee/login        — username + password → JWT
  POST /api/employee/refresh      — Bearer + fp → fresh JWT
  GET  /api/employee/me           — Bearer + fp → profile
  POST /api/employee/change-password
  POST /api/employee/logout

Persistent state lives at ``{netclaw_home}/auth.json``.

The "bundle.json" file is the per-company manifest written into the
PyInstaller payload at build time. Its presence triggers the wizard /
multi-tenant flow; absence falls back to the single-machine NCLW path.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from hermes_constants import get_hermes_home

from hermes_cli.license import (
    DEFAULT_SERVER,
    REQUEST_TIMEOUT_SECONDS,
    LicenseError,
    machine_fingerprint,
    _app_version,
    _now_iso,
    _parse_iso,
)


BUNDLE_SCHEMA_VERSION = 1
AUTH_STATE_VERSION = 1
REFRESH_WITHIN_SECONDS = 6 * 3600  # refresh JWT if it expires in <6h


class EmployeeAuthError(RuntimeError):
    """User-visible auth failure — message is printable directly."""


@dataclass(frozen=True)
class Bundle:
    schema_version: int
    tenant_id: str
    tenant_slug: str
    tenant_name: str
    license_server: str
    require_invite_code: bool
    departments: tuple[dict, ...]
    built_at: Optional[str] = None
    build_signature: Optional[str] = None


@dataclass
class EmployeeState:
    token: str
    employee_id: str
    tenant_id: str
    username: str
    display_name: Optional[str]
    department_id: str
    department_name: Optional[str]
    department_abbrev: Optional[str]
    machine_fingerprint: str
    server: str
    expires_at: Optional[str]
    refreshed_at: str

    def is_expired(self, *, now: Optional[datetime] = None) -> bool:
        if not self.expires_at:
            return False
        now = now or datetime.now(timezone.utc)
        try:
            return _parse_iso(self.expires_at) <= now
        except ValueError:
            return True

    def needs_refresh(self, *, now: Optional[datetime] = None) -> bool:
        if not self.expires_at:
            return False
        now = now or datetime.now(timezone.utc)
        try:
            ttl = (_parse_iso(self.expires_at) - now).total_seconds()
        except ValueError:
            return True
        return ttl < REFRESH_WITHIN_SECONDS


# ---------------------------------------------------------------------------
# bundle.json — per-company manifest baked into the installer
# ---------------------------------------------------------------------------


def bundle_path() -> Optional[Path]:
    """Locate bundle.json: env override → _MEIPASS → netclaw_home → None.

    None means "generic build" — caller falls back to NCLW single-machine flow.
    """
    override = os.getenv("NETCLAW_BUNDLE_JSON")
    if override:
        p = Path(override).expanduser()
        return p if p.is_file() else None

    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        p = Path(meipass) / "bundle.json"
        if p.is_file():
            return p

    p = get_hermes_home() / "bundle.json"
    return p if p.is_file() else None


def load_bundle() -> Optional[Bundle]:
    path = bundle_path()
    if path is None:
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise EmployeeAuthError(f"bundle.json is unreadable: {exc}") from exc
    schema = data.get("schema_version")
    if schema != BUNDLE_SCHEMA_VERSION:
        raise EmployeeAuthError(
            f"bundle.json schema_version={schema} not supported "
            f"(expected {BUNDLE_SCHEMA_VERSION}); upgrade the agent"
        )
    required = ("tenant_id", "tenant_slug", "tenant_name", "license_server")
    missing = [k for k in required if not data.get(k)]
    if missing:
        raise EmployeeAuthError(f"bundle.json missing fields: {', '.join(missing)}")
    departments = data.get("departments") or []
    if not isinstance(departments, list):
        raise EmployeeAuthError("bundle.json 'departments' must be a list")
    return Bundle(
        schema_version=schema,
        tenant_id=data["tenant_id"],
        tenant_slug=data["tenant_slug"],
        tenant_name=data["tenant_name"],
        license_server=data["license_server"].rstrip("/"),
        require_invite_code=bool(data.get("require_invite_code", True)),
        departments=tuple(departments),
        built_at=data.get("built_at"),
        build_signature=data.get("build_signature"),
    )


def server_base(bundle: Optional[Bundle] = None) -> str:
    """Pick license server URL: env > bundle > DEFAULT_SERVER."""
    override = os.getenv("NETCLAW_LICENSE_SERVER")
    if override:
        return override.rstrip("/")
    if bundle is not None:
        return bundle.license_server
    return DEFAULT_SERVER


# ---------------------------------------------------------------------------
# auth.json — local employee session
# ---------------------------------------------------------------------------


def auth_state_path() -> Path:
    return get_hermes_home() / "auth.json"


def load_auth_state() -> Optional[EmployeeState]:
    path = auth_state_path()
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    try:
        return EmployeeState(
            token=data["token"],
            employee_id=data["employee_id"],
            tenant_id=data["tenant_id"],
            username=data["username"],
            display_name=data.get("display_name"),
            department_id=data["department_id"],
            department_name=data.get("department_name"),
            department_abbrev=data.get("department_abbrev"),
            machine_fingerprint=data["machine_fingerprint"],
            server=data["server"],
            expires_at=data.get("expires_at"),
            refreshed_at=data.get("refreshed_at", _now_iso()),
        )
    except (KeyError, TypeError, ValueError):
        return None


def save_auth_state(state: EmployeeState) -> None:
    path = auth_state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"_version": AUTH_STATE_VERSION, **asdict(state)}
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def clear_auth_state() -> None:
    try:
        auth_state_path().unlink()
    except FileNotFoundError:
        pass


# ---------------------------------------------------------------------------
# JWT helpers — payload-only decode (no signature verification; that's the
# server's job. We only read exp/sub locally to drive refresh timing.)
# ---------------------------------------------------------------------------


def jwt_payload(token: str) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) < 2:
        raise EmployeeAuthError("malformed token")
    raw = parts[1]
    pad = "=" * (-len(raw) % 4)
    try:
        decoded = base64.urlsafe_b64decode(raw + pad)
        return json.loads(decoded)
    except (ValueError, json.JSONDecodeError) as exc:
        raise EmployeeAuthError(f"unreadable token payload: {exc}") from exc


def jwt_expires_at(token: str) -> Optional[str]:
    try:
        exp = jwt_payload(token).get("exp")
    except EmployeeAuthError:
        return None
    if not isinstance(exp, (int, float)):
        return None
    return (
        datetime.fromtimestamp(int(exp), tz=timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


# ---------------------------------------------------------------------------
# HTTP — license server employee endpoints
# ---------------------------------------------------------------------------


def _request_json(
    method: str,
    url: str,
    *,
    payload: Optional[dict] = None,
    bearer: Optional[str] = None,
    timeout: int = REQUEST_TIMEOUT_SECONDS,
) -> tuple[int, dict]:
    headers = {
        "User-Agent": f"netclaw-agent/{_app_version()}",
        "Accept": "application/json",
    }
    body: Optional[bytes] = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read() or b"null") or {}
    except urllib.error.HTTPError as err:
        try:
            data = json.loads(err.read() or b"null") or {}
        except Exception:
            data = {"error": f"http_{err.code}"}
        return err.code, data


def _state_from_login_response(
    body: dict, *, server: str, fingerprint: str
) -> EmployeeState:
    token = body.get("token")
    emp = body.get("employee") or {}
    if not token or not emp.get("id"):
        raise EmployeeAuthError("server response missing token or employee fields")
    return EmployeeState(
        token=token,
        employee_id=emp["id"],
        tenant_id=emp.get("tenant_id", ""),
        username=emp.get("username", ""),
        display_name=emp.get("display_name"),
        department_id=emp.get("department_id", ""),
        department_name=emp.get("department_name"),
        department_abbrev=emp.get("department_abbrev"),
        machine_fingerprint=fingerprint,
        server=server,
        expires_at=jwt_expires_at(token),
        refreshed_at=_now_iso(),
    )


def register(
    *,
    invite_code: str,
    raw_username: str,
    password: str,
    bundle: Optional[Bundle] = None,
    fingerprint: Optional[str] = None,
) -> EmployeeState:
    bundle = bundle or load_bundle()
    if bundle is None:
        raise EmployeeAuthError(
            "register requires a per-company bundle (bundle.json) — "
            "this looks like a generic build; use `netclaw license activate <KEY>` instead"
        )
    fp = fingerprint or machine_fingerprint()
    server = server_base(bundle)
    payload = {
        "tenant_id": bundle.tenant_id,
        "invite_code": invite_code.strip().upper(),
        "raw_username": raw_username.strip(),
        "password": password,
        "machine_fingerprint": fp,
    }
    status, body = _request_json(
        "POST", f"{server}/api/employee/register", payload=payload
    )
    if status != 200 and status != 201:
        raise EmployeeAuthError(_format_err("register failed", status, body))
    state = _state_from_login_response(body, server=server, fingerprint=fp)
    save_auth_state(state)
    return state


def login(
    *,
    username: str,
    password: str,
    bundle: Optional[Bundle] = None,
    fingerprint: Optional[str] = None,
) -> EmployeeState:
    bundle = bundle or load_bundle()
    fp = fingerprint or machine_fingerprint()
    server = server_base(bundle)
    payload: dict[str, Any] = {
        "username": username.strip(),
        "password": password,
        "machine_fingerprint": fp,
    }
    if bundle is not None:
        payload["tenant_id"] = bundle.tenant_id
    status, body = _request_json(
        "POST", f"{server}/api/employee/login", payload=payload
    )
    if status != 200:
        raise EmployeeAuthError(_format_err("login failed", status, body))
    state = _state_from_login_response(body, server=server, fingerprint=fp)
    save_auth_state(state)
    return state


def refresh(state: Optional[EmployeeState] = None) -> EmployeeState:
    state = state or load_auth_state()
    if state is None:
        raise EmployeeAuthError("not logged in")
    status, body = _request_json(
        "POST", f"{state.server}/api/employee/refresh", bearer=state.token
    )
    if status != 200:
        raise EmployeeAuthError(_format_err("refresh failed", status, body))
    new_token = body.get("token")
    if not new_token:
        raise EmployeeAuthError("refresh response missing token")
    state.token = new_token
    state.expires_at = jwt_expires_at(new_token)
    state.refreshed_at = _now_iso()
    save_auth_state(state)
    return state


def me(state: Optional[EmployeeState] = None) -> dict:
    state = state or load_auth_state()
    if state is None:
        raise EmployeeAuthError("not logged in")
    status, body = _request_json(
        "GET", f"{state.server}/api/employee/me", bearer=state.token
    )
    if status != 200:
        raise EmployeeAuthError(_format_err("whoami failed", status, body))
    return body.get("employee") or {}


def change_password(
    *, old_password: str, new_password: str, state: Optional[EmployeeState] = None
) -> None:
    state = state or load_auth_state()
    if state is None:
        raise EmployeeAuthError("not logged in")
    status, body = _request_json(
        "POST",
        f"{state.server}/api/employee/change-password",
        payload={"old_password": old_password, "new_password": new_password},
        bearer=state.token,
    )
    if status != 200:
        raise EmployeeAuthError(_format_err("change-password failed", status, body))


def logout(state: Optional[EmployeeState] = None) -> None:
    state = state or load_auth_state()
    if state is not None:
        try:
            _request_json(
                "POST", f"{state.server}/api/employee/logout", bearer=state.token
            )
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
    clear_auth_state()


def ensure_session(*, network: bool = True) -> Optional[EmployeeState]:
    """Return a valid logged-in session, refreshing transparently if needed.

    None means "no bundle and no session" — the caller should fall through to
    the single-machine NCLW path.
    """
    state = load_auth_state()
    if state is None:
        return None
    if state.is_expired():
        clear_auth_state()
        raise EmployeeAuthError("session expired — please log in again")
    if network and state.needs_refresh():
        try:
            return refresh(state)
        except EmployeeAuthError:
            return state
    return state


# ---------------------------------------------------------------------------
# Error code → human hint
# ---------------------------------------------------------------------------


_ERROR_HINTS: dict[str, str] = {
    "invite_not_found": "邀请码不存在或已被撤销 — 联系公司管理员重新发邀请",
    "invite_used": "邀请码已被使用 — 联系公司管理员重新发邀请",
    "invite_expired": "邀请码已过期 — 联系公司管理员重新发邀请",
    "invite_tenant_mismatch": "邀请码不属于这个安装包对应的公司 — 安装包错配",
    "invalid_password": "密码不符合要求（至少 8 位）",
    "weak_password": "密码太弱：必须同时包含字母和数字",
    "username_exists": "这个 username 在公司里已被占用 — 换一个 raw_username",
    "bad_credentials": "用户名或密码不正确",
    "fingerprint_mismatch": "这个员工已绑定到另一台机器 — 联系管理员先解绑",
    "not_active": "账号已被停用 — 联系公司管理员",
    "tenant_suspended": "公司账号已被停用 — 联系销售",
    "department_archived": "部门已归档 — 联系管理员调到其他部门",
    "fingerprint_drift": "机器指纹已变（换机器或重装系统？）— 联系管理员解绑后重新登录",
    "missing_bearer": "服务端拒绝（缺 token）— 重新登录",
    "invalid_bearer": "服务端拒绝（token 无效）— 重新登录",
    "employee_inactive": "账号被停用 — 联系公司管理员",
    "bad_old_password": "旧密码不正确",
}


def _format_err(prefix: str, status: int, body: dict) -> str:
    err = body.get("error") if isinstance(body, dict) else None
    msg = body.get("message") if isinstance(body, dict) else None
    hint = _ERROR_HINTS.get(err, msg or err or f"HTTP {status}")
    return f"{prefix}: {hint}"


# Re-export LicenseError for callers that want to catch both.
__all__ = [
    "Bundle",
    "EmployeeState",
    "EmployeeAuthError",
    "LicenseError",
    "load_bundle",
    "bundle_path",
    "server_base",
    "load_auth_state",
    "save_auth_state",
    "clear_auth_state",
    "jwt_payload",
    "jwt_expires_at",
    "register",
    "login",
    "refresh",
    "me",
    "change_password",
    "logout",
    "ensure_session",
]
