"""argparse subcommands for ``netclaw login / logout / whoami / change-password``.

Wires :mod:`hermes_cli.employee_auth` into the CLI. Mounted from
:mod:`hermes_cli.main` next to ``netclaw license …``.

When ``bundle.json`` is absent the CLI prints a hint pointing at
``netclaw license activate`` instead — single-machine users keep the old
flow.
"""

from __future__ import annotations

import argparse
import getpass
import json
import sys
from typing import Optional

from hermes_cli import employee_auth as ea


def _read_password(prompt: str) -> str:
    """Read a password from a TTY, falling back to stdin for piped flows."""
    if sys.stdin.isatty():
        return getpass.getpass(prompt)
    return sys.stdin.readline().rstrip("\n")


def _resolve_password(args, prompt: str) -> str:
    pw = getattr(args, "password", None)
    if pw:
        return pw
    return _read_password(prompt)


def cmd_login(args: argparse.Namespace) -> int:
    bundle = ea.load_bundle()
    password = _resolve_password(args, "Password: ")
    try:
        state = ea.login(username=args.username, password=password, bundle=bundle)
    except ea.EmployeeAuthError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    dept = state.department_name or state.department_id
    print(f"logged in as {state.username} ({dept})")
    if state.expires_at:
        print(f"session expires at: {state.expires_at}")
    return 0


def cmd_register(args: argparse.Namespace) -> int:
    bundle = ea.load_bundle()
    if bundle is None:
        print(
            "error: register requires a per-company installer (bundle.json missing). "
            "If you have an NCLW license key, use `netclaw license activate <key>` instead.",
            file=sys.stderr,
        )
        return 1
    password = _resolve_password(args, "New password (>= 8 chars): ")
    try:
        state = ea.register(
            invite_code=args.invite_code,
            raw_username=args.raw_username,
            password=password,
            bundle=bundle,
        )
    except ea.EmployeeAuthError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    print(f"registered as {state.username} ({state.department_name or '—'})")
    return 0


def cmd_logout(args: argparse.Namespace) -> int:
    state = ea.load_auth_state()
    if state is None:
        print("nothing to do — not logged in")
        return 0
    ea.logout(state)
    print("logged out")
    return 0


def cmd_whoami(args: argparse.Namespace) -> int:
    state = ea.load_auth_state()
    if state is None:
        if ea.bundle_path() is None:
            print(
                "not logged in (this is a generic build — use `netclaw license activate <key>`)"
            )
        else:
            print("not logged in — run `netclaw login <username>`")
        return 1
    info = {
        "username": state.username,
        "display_name": state.display_name,
        "tenant_id": state.tenant_id,
        "department": state.department_name,
        "department_abbrev": state.department_abbrev,
        "machine_fingerprint": state.machine_fingerprint,
        "server": state.server,
        "expires_at": state.expires_at,
    }
    if args.json:
        print(json.dumps(info, indent=2, ensure_ascii=False))
        return 0
    print(f"username   : {info['username']}")
    if info["display_name"]:
        print(f"display    : {info['display_name']}")
    print(f"department : {info['department']} ({info['department_abbrev']})")
    print(f"tenant     : {info['tenant_id']}")
    print(f"server     : {info['server']}")
    if info["expires_at"]:
        print(f"expires    : {info['expires_at']}")
    return 0


def cmd_change_password(args: argparse.Namespace) -> int:
    state = ea.load_auth_state()
    if state is None:
        print(
            "error: not logged in — run `netclaw login <username>` first",
            file=sys.stderr,
        )
        return 1
    old = _read_password("Current password: ")
    new = _read_password("New password (>= 8 chars, must include letter + digit): ")
    confirm = _read_password("Confirm new password: ")
    if new != confirm:
        print("error: new passwords do not match", file=sys.stderr)
        return 1
    try:
        ea.change_password(old_password=old, new_password=new, state=state)
    except ea.EmployeeAuthError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    print("password updated")
    return 0


def register_subparser(subparsers) -> None:
    """Mount login / logout / whoami / change-password / register subcommands.

    Each is a top-level command (not nested under one parent) — that's how
    CLAs typically expose login: ``netclaw login <username>``.
    """

    p_login = subparsers.add_parser(
        "login",
        help="Log in as a NetClaw company employee",
        description="Authenticate with your company's NetClaw License Server "
        "and store a session token at ~/.netclaw/auth.json.",
    )
    p_login.add_argument("username", help="Full username, e.g. dev-zhangsan")
    p_login.add_argument(
        "--password",
        help="Provide password inline (else prompt). Avoid in shells with history.",
    )
    p_login.set_defaults(func=cmd_login)

    p_register = subparsers.add_parser(
        "register",
        help="Self-register with a one-time invite code (per-company installer only)",
        description="Consumes a one-time invite code from your company admin to "
        "create your employee account. Only available in per-company installers.",
    )
    p_register.add_argument("invite_code", help="One-time invite code (8 chars)")
    p_register.add_argument(
        "raw_username",
        help="Your raw username (department prefix added automatically)",
    )
    p_register.add_argument(
        "--password",
        help="Provide password inline (else prompt).",
    )
    p_register.set_defaults(func=cmd_register)

    p_logout = subparsers.add_parser(
        "logout",
        help="Clear stored session token",
    )
    p_logout.set_defaults(func=cmd_logout)

    p_whoami = subparsers.add_parser(
        "whoami",
        help="Show current logged-in employee",
    )
    p_whoami.add_argument("--json", action="store_true", help="Emit JSON")
    p_whoami.set_defaults(func=cmd_whoami)

    p_pw = subparsers.add_parser(
        "change-password",
        help="Change your NetClaw login password",
    )
    p_pw.set_defaults(func=cmd_change_password)
