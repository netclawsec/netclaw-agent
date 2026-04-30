"""NetClaw Agent — Windows console launcher.

Entry script for the PyInstaller-built ``netclaw.exe`` on Windows. Sets
the bundled-skills env vars then dispatches into ``hermes_cli.main``.

The launcher is intentionally thin so most behaviour lives in the
real CLI and is testable from a normal dev install.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _frozen_resource_dir() -> Path:
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass)
    return Path(__file__).resolve().parent.parent.parent


def _setup_environment() -> None:
    resources = _frozen_resource_dir()
    skills_dir = resources / "skills"
    optional_skills_dir = resources / "optional-skills"
    if skills_dir.is_dir():
        os.environ.setdefault("HERMES_BUNDLED_SKILLS", str(skills_dir))
    if optional_skills_dir.is_dir():
        os.environ.setdefault("HERMES_OPTIONAL_SKILLS", str(optional_skills_dir))
    os.environ.setdefault("NETCLAW_MANAGED", "windows-installer")
    os.environ.setdefault("HERMES_MANAGED", "windows-installer")
    # Force UTF-8 stdout/stderr on Windows so emoji + Chinese in CLI output
    # don't crash with GBK UnicodeEncodeError on default cmd.exe codepage.
    if os.name == "nt":
        os.environ.setdefault("PYTHONUTF8", "1")
        os.environ.setdefault("PYTHONIOENCODING", "utf-8")
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass


def main() -> int:
    _setup_environment()
    try:
        from hermes_cli.main import main as cli_main
    except Exception as err:
        print(f"netclaw: failed to load CLI: {err}", file=sys.stderr)
        return 1
    return int(cli_main() or 0)


if __name__ == "__main__":
    sys.exit(main())
