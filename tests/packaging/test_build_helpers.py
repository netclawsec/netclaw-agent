"""Unit tests for packaging/windows/build_helpers.py.

The helper runs at build time (from build.ps1) before the project's own
deps are installed, so it MUST stay zero-dep. These tests pin:
  * bundle.json schema validation (parity with hermes_cli.employee_auth)
  * deterministic AppId generation (so re-builds upgrade in place, not
    sit alongside the prior install)
  * slug + version syntax guards (any drift would let bad characters
    leak into Inno Setup defines and break ISCC at compile time)
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

# Load build_helpers.py by path — packaging/ has no __init__.py and we
# don't want to add one (it's a script directory, not an importable pkg).
_REPO_ROOT = Path(__file__).resolve().parents[2]
_HELPER_PATH = _REPO_ROOT / "packaging" / "windows" / "build_helpers.py"
_spec = importlib.util.spec_from_file_location("build_helpers", _HELPER_PATH)
assert _spec and _spec.loader, f"could not load {_HELPER_PATH}"
build_helpers = importlib.util.module_from_spec(_spec)
sys.modules["build_helpers"] = build_helpers
_spec.loader.exec_module(build_helpers)


def _good_bundle(**overrides) -> dict:
    payload = {
        "schema_version": 1,
        "tenant_id": "tenant-001",
        "tenant_slug": "acme",
        "tenant_name": "Acme 软件",
        "license_server": "https://license.example.com",
        "require_invite_code": True,
        "departments": [
            {"id": "d1", "name": "研发部", "abbrev": "dev"},
            {"id": "d2", "name": "市场部", "abbrev": "mkt"},
        ],
        "built_at": "2026-04-30T00:00:00Z",
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def bundle_path(tmp_path):
    def _write(payload):
        p = tmp_path / "bundle.json"
        p.write_text(json.dumps(payload), encoding="utf-8")
        return p

    return _write


# --------------------------------------------------------------------------
# validate_bundle
# --------------------------------------------------------------------------


def test_validate_bundle_accepts_minimal_valid_payload(bundle_path):
    summary = build_helpers.validate_bundle(bundle_path(_good_bundle()))
    assert summary.tenant_id == "tenant-001"
    assert summary.tenant_slug == "acme"
    assert summary.license_server == "https://license.example.com"
    assert summary.department_count == 2
    assert summary.require_invite_code is True


def test_validate_bundle_strips_trailing_slash(bundle_path):
    summary = build_helpers.validate_bundle(
        bundle_path(_good_bundle(license_server="https://license.example.com/"))
    )
    assert summary.license_server == "https://license.example.com"


def test_validate_bundle_rejects_missing_file(tmp_path):
    with pytest.raises(build_helpers.BundleError, match="not found"):
        build_helpers.validate_bundle(tmp_path / "nope.json")


def test_validate_bundle_rejects_invalid_json(tmp_path):
    p = tmp_path / "bundle.json"
    p.write_text("not json", encoding="utf-8")
    with pytest.raises(build_helpers.BundleError, match="not valid JSON"):
        build_helpers.validate_bundle(p)


def test_validate_bundle_rejects_unsupported_schema(bundle_path):
    with pytest.raises(build_helpers.BundleError, match="schema_version"):
        build_helpers.validate_bundle(bundle_path(_good_bundle(schema_version=999)))


def test_validate_bundle_rejects_missing_required_field(bundle_path):
    with pytest.raises(build_helpers.BundleError, match="missing fields"):
        build_helpers.validate_bundle(bundle_path(_good_bundle(tenant_id="")))


def test_validate_bundle_rejects_bad_slug(bundle_path):
    with pytest.raises(build_helpers.BundleError, match="tenant_slug"):
        build_helpers.validate_bundle(bundle_path(_good_bundle(tenant_slug="Acme!")))


def test_validate_bundle_rejects_non_http_server(bundle_path):
    with pytest.raises(build_helpers.BundleError, match="license_server"):
        build_helpers.validate_bundle(
            bundle_path(_good_bundle(license_server="ftp://example.com"))
        )


def test_validate_bundle_rejects_dept_missing_abbrev(bundle_path):
    with pytest.raises(build_helpers.BundleError, match="missing name/abbrev"):
        build_helpers.validate_bundle(
            bundle_path(_good_bundle(departments=[{"id": "x", "name": "研发"}]))
        )


def test_validate_bundle_rejects_root_array(tmp_path):
    p = tmp_path / "bundle.json"
    p.write_text("[]", encoding="utf-8")
    with pytest.raises(build_helpers.BundleError, match="JSON object"):
        build_helpers.validate_bundle(p)


# --------------------------------------------------------------------------
# tenant_app_id
# --------------------------------------------------------------------------


def test_tenant_app_id_is_deterministic():
    assert build_helpers.tenant_app_id("acme") == build_helpers.tenant_app_id("acme")


def test_tenant_app_id_differs_per_slug():
    assert build_helpers.tenant_app_id("acme") != build_helpers.tenant_app_id("globex")


def test_tenant_app_id_inno_setup_syntax():
    """Inno Setup expects ``{{<GUID>}`` — doubled opening brace + single close."""
    appid = build_helpers.tenant_app_id("acme")
    assert appid.startswith("{{")
    assert appid.endswith("}")
    assert appid.count("{") == 2
    assert appid.count("}") == 1
    # 8-4-4-4-12 hex digits
    inner = appid.strip("{}")
    parts = inner.split("-")
    assert [len(p) for p in parts] == [8, 4, 4, 4, 12]


def test_tenant_app_id_rejects_bad_slug():
    with pytest.raises(build_helpers.BundleError):
        build_helpers.tenant_app_id("Acme!")


# --------------------------------------------------------------------------
# tenant_install_subdir / output_basename / display_app_name
# --------------------------------------------------------------------------


def test_install_subdir_format():
    assert build_helpers.tenant_install_subdir("acme") == "Agent-acme"


def test_install_subdir_rejects_bad_slug():
    with pytest.raises(build_helpers.BundleError):
        build_helpers.tenant_install_subdir("ACME")


def test_output_basename_format():
    assert (
        build_helpers.output_basename("acme", "0.10.0")
        == "NetClaw-Agent-Setup-acme-0.10.0"
    )


def test_output_basename_rejects_bad_version():
    with pytest.raises(build_helpers.BundleError):
        build_helpers.output_basename("acme", "v1.0")


def test_display_name_truncates_long():
    long = "x" * 200
    assert build_helpers.display_app_name(long).startswith("NetClaw Agent — ")
    assert len(build_helpers.display_app_name(long)) <= len("NetClaw Agent — ") + 48


def test_display_name_falls_back_when_blank():
    assert build_helpers.display_app_name("   ") == "NetClaw Agent"


# --------------------------------------------------------------------------
# CLI shim — build.ps1 calls these
# --------------------------------------------------------------------------


def test_cli_validate_returns_0_for_valid(bundle_path, capsys):
    rc = build_helpers._cli(["validate", str(bundle_path(_good_bundle()))])
    assert rc == 0
    out = capsys.readouterr().out
    parsed = json.loads(out)
    assert parsed["tenant_slug"] == "acme"


def test_cli_validate_returns_2_for_invalid(tmp_path, capsys):
    p = tmp_path / "bundle.json"
    p.write_text("not json", encoding="utf-8")
    rc = build_helpers._cli(["validate", str(p)])
    assert rc == 2
    err = capsys.readouterr().err
    assert "ERROR" in err


def test_cli_app_id_prints_deterministic(capsys):
    build_helpers._cli(["app-id", "acme"])
    a = capsys.readouterr().out.strip()
    build_helpers._cli(["app-id", "acme"])
    b = capsys.readouterr().out.strip()
    assert a == b
