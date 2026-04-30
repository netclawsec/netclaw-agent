"""Unit tests for hermes_cli.employee_auth — local-only logic.

Network paths (register/login/refresh/me/change_password/logout) are exercised
through tests/integration/ against a real license server when CI runs against
one; here we only cover the parts that should never touch the network:
  * bundle.json schema validation
  * auth.json round-trip
  * JWT payload decoding
  * server_base resolution precedence
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

from hermes_cli import employee_auth as ea


@pytest.fixture
def isolated_home(tmp_path, monkeypatch):
    monkeypatch.setenv("NETCLAW_HOME", str(tmp_path))
    monkeypatch.delenv("NETCLAW_BUNDLE_JSON", raising=False)
    monkeypatch.delenv("NETCLAW_LICENSE_SERVER", raising=False)
    return tmp_path


def _write_bundle(home: Path, **overrides) -> Path:
    payload: dict = {
        "schema_version": ea.BUNDLE_SCHEMA_VERSION,
        "tenant_id": "tenant-001",
        "tenant_slug": "acme",
        "tenant_name": "Acme 软件",
        "license_server": "https://license.example.com",
        "require_invite_code": True,
        "departments": [
            {"id": "d-1", "name": "研发部", "abbrev": "dev"},
            {"id": "d-2", "name": "市场部", "abbrev": "mkt"},
        ],
        "built_at": "2026-04-30T00:00:00Z",
    }
    payload.update(overrides)
    path = home / "bundle.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


# ---------------- bundle.json -------------------------------------------------


def test_load_bundle_returns_none_when_missing(isolated_home):
    assert ea.load_bundle() is None


def test_load_bundle_parses_valid_payload(isolated_home):
    _write_bundle(isolated_home)
    bundle = ea.load_bundle()
    assert bundle is not None
    assert bundle.tenant_id == "tenant-001"
    assert bundle.tenant_slug == "acme"
    assert bundle.license_server == "https://license.example.com"
    assert len(bundle.departments) == 2
    assert bundle.require_invite_code is True


def test_load_bundle_rejects_unsupported_schema(isolated_home):
    _write_bundle(isolated_home, schema_version=999)
    with pytest.raises(ea.EmployeeAuthError, match="schema_version"):
        ea.load_bundle()


def test_load_bundle_rejects_missing_required_field(isolated_home):
    _write_bundle(isolated_home, tenant_id="")
    with pytest.raises(ea.EmployeeAuthError, match="missing fields"):
        ea.load_bundle()


def test_load_bundle_rejects_unreadable_json(isolated_home):
    (isolated_home / "bundle.json").write_text("not json", encoding="utf-8")
    with pytest.raises(ea.EmployeeAuthError, match="unreadable"):
        ea.load_bundle()


def test_load_bundle_strips_trailing_slash(isolated_home):
    _write_bundle(isolated_home, license_server="https://license.example.com/")
    bundle = ea.load_bundle()
    assert bundle.license_server == "https://license.example.com"


def test_bundle_path_env_override(isolated_home, tmp_path, monkeypatch):
    custom = tmp_path / "custom.json"
    custom.write_text("{}", encoding="utf-8")
    monkeypatch.setenv("NETCLAW_BUNDLE_JSON", str(custom))
    assert ea.bundle_path() == custom


# ---------------- server_base precedence -------------------------------------


def test_server_base_default(isolated_home):
    assert ea.server_base() == ea.DEFAULT_SERVER


def test_server_base_uses_bundle(isolated_home):
    _write_bundle(isolated_home)
    bundle = ea.load_bundle()
    assert ea.server_base(bundle) == "https://license.example.com"


def test_server_base_env_overrides_bundle(isolated_home, monkeypatch):
    _write_bundle(isolated_home)
    monkeypatch.setenv("NETCLAW_LICENSE_SERVER", "https://override.example.com/")
    bundle = ea.load_bundle()
    assert ea.server_base(bundle) == "https://override.example.com"


# ---------------- auth.json round-trip ---------------------------------------


def _state(**overrides) -> ea.EmployeeState:
    base = dict(
        token="tok",
        employee_id="emp-1",
        tenant_id="tenant-1",
        username="dev-zhangsan",
        display_name="张三",
        department_id="d-1",
        department_name="研发部",
        department_abbrev="dev",
        machine_fingerprint="fp-aaaa-bbbb",
        server="https://license.example.com",
        expires_at="2099-01-01T00:00:00Z",
        refreshed_at="2026-04-30T00:00:00Z",
    )
    base.update(overrides)
    return ea.EmployeeState(**base)


def test_auth_state_round_trip(isolated_home):
    assert ea.load_auth_state() is None
    state = _state()
    ea.save_auth_state(state)
    loaded = ea.load_auth_state()
    assert loaded is not None
    assert loaded.username == "dev-zhangsan"
    assert loaded.token == "tok"
    assert loaded.machine_fingerprint == "fp-aaaa-bbbb"


def test_auth_state_clear(isolated_home):
    ea.save_auth_state(_state())
    ea.clear_auth_state()
    assert ea.load_auth_state() is None


def test_auth_state_atomic_write_no_partial_file(isolated_home):
    ea.save_auth_state(_state())
    contents = ea.auth_state_path().read_text(encoding="utf-8")
    json.loads(contents)  # must parse — no half-written truncation


def test_auth_state_returns_none_on_corrupt_json(isolated_home):
    ea.auth_state_path().parent.mkdir(parents=True, exist_ok=True)
    ea.auth_state_path().write_text("not json", encoding="utf-8")
    assert ea.load_auth_state() is None


def test_state_is_expired_in_past(isolated_home):
    assert _state(expires_at="2000-01-01T00:00:00Z").is_expired() is True


def test_state_is_not_expired_in_future(isolated_home):
    assert _state(expires_at="2099-01-01T00:00:00Z").is_expired() is False


def test_state_needs_refresh_when_close_to_expiry(isolated_home):
    from datetime import datetime, timedelta, timezone

    soon = datetime.now(timezone.utc) + timedelta(minutes=5)
    iso = soon.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    assert _state(expires_at=iso).needs_refresh() is True


# ---------------- JWT helpers -------------------------------------------------


def _fake_jwt(payload: dict) -> str:
    def _b64(obj):
        raw = json.dumps(obj).encode("utf-8")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    header = _b64({"alg": "HS256", "typ": "JWT"})
    body = _b64(payload)
    return f"{header}.{body}.signature-not-checked"


def test_jwt_payload_decodes(isolated_home):
    token = _fake_jwt({"sub": "emp-1", "exp": 9999999999})
    assert ea.jwt_payload(token)["sub"] == "emp-1"


def test_jwt_expires_at_returns_iso(isolated_home):
    token = _fake_jwt({"sub": "x", "exp": 1893456000})  # 2030-01-01
    iso = ea.jwt_expires_at(token)
    assert iso is not None and iso.startswith("2030")


def test_jwt_expires_at_none_when_missing(isolated_home):
    token = _fake_jwt({"sub": "x"})
    assert ea.jwt_expires_at(token) is None


def test_jwt_payload_rejects_malformed_token(isolated_home):
    with pytest.raises(ea.EmployeeAuthError):
        ea.jwt_payload("not-a-jwt")


# ---------------- error formatter --------------------------------------------


def test_format_err_uses_known_hint(isolated_home):
    msg = ea._format_err("login failed", 400, {"error": "bad_credentials"})
    assert "login failed" in msg
    assert "用户名或密码不正确" in msg


def test_format_err_falls_back_to_message(isolated_home):
    msg = ea._format_err("x", 400, {"error": "weird_error", "message": "oh no"})
    assert "oh no" in msg


def test_register_without_bundle_raises(isolated_home):
    with pytest.raises(ea.EmployeeAuthError, match="bundle"):
        ea.register(invite_code="ABC", raw_username="bob", password="pass1234")
