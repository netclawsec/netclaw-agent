"""Build-time helpers for per-tenant Windows installers.

Used by ``build.ps1`` (via ``python build_helpers.py <subcommand>``) and by
``netclaw.spec`` (via direct import) to:

  * validate ``bundle.json`` shape *before* PyInstaller / Inno Setup runs,
    so a busted manifest fails loudly at minute 1 instead of producing a
    silently-broken installer 15 minutes later.
  * derive a deterministic Inno Setup ``AppId`` GUID from the tenant slug,
    so two different tenants installed on the same machine register as
    distinct apps in Add/Remove Programs.
  * derive the per-tenant install-dir suffix and the installer's
    ``OutputBaseFilename`` so naming is centralized in one place.

This module is import-safe with no project deps — it runs from a fresh
build venv before ``uv pip install -e .`` finishes its work.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


SCHEMA_VERSION = 1
# Fixed namespace for uuid5(slug) → AppId. Do NOT change without a migration
# story; flipping this regenerates AppIds and orphans existing installs.
APP_ID_NAMESPACE = uuid.UUID("6f0b6f35-9d2e-4e0f-8a37-8a370b6f0b6f")
SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$")
REQUIRED_TOP_LEVEL = ("tenant_id", "tenant_slug", "tenant_name", "license_server")


class BundleError(ValueError):
    """Raised when bundle.json fails validation. Message is user-visible."""


@dataclass(frozen=True)
class BundleSummary:
    schema_version: int
    tenant_id: str
    tenant_slug: str
    tenant_name: str
    license_server: str
    require_invite_code: bool
    department_count: int


def validate_bundle(path: Path) -> BundleSummary:
    """Parse + schema-check a bundle.json file. Raises ``BundleError`` on failure."""
    if not path.is_file():
        raise BundleError(f"bundle.json not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise BundleError(f"bundle.json is not valid JSON: {exc}") from exc
    except OSError as exc:
        raise BundleError(f"bundle.json unreadable: {exc}") from exc

    if not isinstance(data, dict):
        raise BundleError("bundle.json root must be a JSON object")

    schema = data.get("schema_version")
    if schema != SCHEMA_VERSION:
        raise BundleError(
            f"bundle.json schema_version={schema!r} not supported "
            f"(expected {SCHEMA_VERSION})"
        )

    missing = [k for k in REQUIRED_TOP_LEVEL if not data.get(k)]
    if missing:
        raise BundleError(f"bundle.json missing fields: {', '.join(missing)}")

    slug = data["tenant_slug"]
    if not SLUG_RE.match(slug):
        raise BundleError(
            f"bundle.json tenant_slug={slug!r} must match {SLUG_RE.pattern} "
            "(lowercase letters/digits/dash, 1-32 chars, no leading/trailing dash)"
        )

    license_server = data["license_server"]
    if not isinstance(license_server, str) or not license_server.startswith(
        ("http://", "https://")
    ):
        raise BundleError(
            f"bundle.json license_server={license_server!r} must be http(s) URL"
        )

    departments = data.get("departments") or []
    if not isinstance(departments, list):
        raise BundleError("bundle.json departments must be a list")
    for i, dep in enumerate(departments):
        if not isinstance(dep, dict):
            raise BundleError(f"bundle.json departments[{i}] must be an object")
        if not dep.get("name") or not dep.get("abbrev"):
            raise BundleError(f"bundle.json departments[{i}] missing name/abbrev")

    return BundleSummary(
        schema_version=schema,
        tenant_id=str(data["tenant_id"]),
        tenant_slug=slug,
        tenant_name=str(data["tenant_name"]),
        license_server=license_server.rstrip("/"),
        require_invite_code=bool(data.get("require_invite_code", True)),
        department_count=len(departments),
    )


def tenant_app_id(tenant_slug: str) -> str:
    """Deterministic Inno Setup AppId for a tenant slug.

    Inno Setup expects the AppId in the form ``{{<GUID>}`` (note the doubled
    opening brace — Inno strips the first to form a literal ``{<GUID>}`` at
    install time). ``uuid5`` over a fixed namespace gives a stable GUID per
    slug, so re-builds for the same tenant always upgrade in place.
    """
    if not SLUG_RE.match(tenant_slug):
        raise BundleError(f"invalid tenant_slug: {tenant_slug!r}")
    guid = uuid.uuid5(APP_ID_NAMESPACE, f"netclaw-agent:{tenant_slug}")
    return "{{" + str(guid).upper() + "}"


def tenant_install_subdir(tenant_slug: str) -> str:
    """Per-tenant install-dir suffix under ``%ProgramFiles%\\NetClaw``."""
    if not SLUG_RE.match(tenant_slug):
        raise BundleError(f"invalid tenant_slug: {tenant_slug!r}")
    return f"Agent-{tenant_slug}"


def output_basename(tenant_slug: str, version: str) -> str:
    if not SLUG_RE.match(tenant_slug):
        raise BundleError(f"invalid tenant_slug: {tenant_slug!r}")
    if not re.match(r"^\d+(\.\d+){1,3}$", version):
        raise BundleError(f"invalid version: {version!r}")
    return f"NetClaw-Agent-Setup-{tenant_slug}-{version}"


def display_app_name(tenant_name: str) -> str:
    """Add/Remove Programs display name; truncated to keep Inno happy."""
    cleaned = tenant_name.strip().replace("\n", " ")
    if not cleaned:
        return "NetClaw Agent"
    return f"NetClaw Agent — {cleaned[:48]}"


# ---------------------------------------------------------------------------
# CLI shim — invoked by build.ps1
# ---------------------------------------------------------------------------


def _cli(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(prog="build_helpers")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_validate = sub.add_parser("validate", help="validate bundle.json")
    p_validate.add_argument("path", type=Path)

    p_appid = sub.add_parser("app-id", help="print Inno Setup AppId for slug")
    p_appid.add_argument("slug")

    p_subdir = sub.add_parser(
        "install-subdir", help="print per-tenant install dir suffix"
    )
    p_subdir.add_argument("slug")

    p_out = sub.add_parser("output-basename", help="print OutputBaseFilename")
    p_out.add_argument("slug")
    p_out.add_argument("version")

    p_name = sub.add_parser("display-name", help="print Add/Remove Programs name")
    p_name.add_argument("tenant_name")

    args = parser.parse_args(argv)
    try:
        if args.cmd == "validate":
            summary = validate_bundle(args.path)
            print(json.dumps(summary.__dict__, ensure_ascii=False))
            return 0
        if args.cmd == "app-id":
            print(tenant_app_id(args.slug))
            return 0
        if args.cmd == "install-subdir":
            print(tenant_install_subdir(args.slug))
            return 0
        if args.cmd == "output-basename":
            print(output_basename(args.slug, args.version))
            return 0
        if args.cmd == "display-name":
            print(display_app_name(args.tenant_name))
            return 0
    except BundleError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    return 1


if __name__ == "__main__":
    raise SystemExit(_cli(sys.argv[1:]))
