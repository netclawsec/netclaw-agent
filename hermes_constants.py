"""Shared constants for NetClaw Agent (internal module name: hermes_constants).

Import-safe module with no dependencies — can be imported from anywhere
without risk of circular imports.

NetClaw Agent productization shim: on import, any ``NETCLAW_*`` environment
variable is mirrored into the legacy ``HERMES_*`` name so downstream code
keeps reading the internal contract while users interact with the branded
names.  The home directory defaults to ``~/.netclaw`` for fresh installs
but keeps ``~/.hermes`` for existing deployments to avoid breaking them.
"""

import os
from pathlib import Path


def _propagate_netclaw_env() -> None:
    """Copy ``NETCLAW_*`` env vars into their legacy ``HERMES_*`` siblings.

    Users only see ``NETCLAW_*`` names in docs and error messages; the
    internal codebase continues to read ``HERMES_*`` from a single central
    shim here.  Legacy values win only when the new name is absent.
    """
    for key, value in list(os.environ.items()):
        if not key.startswith("NETCLAW_"):
            continue
        legacy_key = "HERMES_" + key[len("NETCLAW_") :]
        if legacy_key not in os.environ:
            os.environ[legacy_key] = value


# Run once at import time so every subsequent os.getenv("HERMES_*") sees
# values the user supplied via the branded NETCLAW_* name.
_propagate_netclaw_env()


_NETCLAW_DIRNAME = ".netclaw"
_LEGACY_DIRNAME = ".hermes"


def _resolve_home_default() -> Path:
    """Return the default NetClaw data directory, honoring legacy layouts.

    Resolution order:
    1. ``NETCLAW_HOME`` / ``HERMES_HOME`` env var (already propagated above).
    2. Existing ``~/.netclaw`` directory — new-style install.
    3. Existing ``~/.hermes`` directory — legacy install kept untouched.
    4. Fresh install — new path (``~/.netclaw``).
    """
    override = os.getenv("NETCLAW_HOME") or os.getenv("HERMES_HOME")
    if override:
        return Path(override)
    netclaw_dir = Path.home() / _NETCLAW_DIRNAME
    hermes_dir = Path.home() / _LEGACY_DIRNAME
    if netclaw_dir.exists():
        return netclaw_dir
    if hermes_dir.exists():
        return hermes_dir
    return netclaw_dir


def get_hermes_home() -> Path:
    """Return the NetClaw Agent data directory.

    Default is ``~/.netclaw``; legacy ``~/.hermes`` installs keep working
    without migration.  Users override via ``NETCLAW_HOME`` (preferred) or
    ``HERMES_HOME`` (legacy alias).

    Function name is preserved for internal call sites; the user-facing
    name is the **NetClaw home directory**.
    """
    return _resolve_home_default()


def get_default_hermes_root() -> Path:
    """Return the root NetClaw data directory for profile-level operations.

    In standard deployments this is ``~/.netclaw`` (or ``~/.hermes`` for
    legacy installs that still have that directory).

    In Docker or custom deployments where the home env var points outside
    the standard location (e.g. ``/opt/data``), returns that path directly
    — that IS the root.

    In profile mode where the home points at ``<root>/profiles/<name>``,
    returns ``<root>`` so ``profile list`` can see all profiles.  Works for
    both native (``~/.netclaw/profiles/coder``) and Docker
    (``/opt/data/profiles/coder``) layouts.

    Import-safe — no dependencies beyond stdlib.
    """
    native_home = _resolve_home_default()
    env_home = os.environ.get("NETCLAW_HOME") or os.environ.get("HERMES_HOME", "")
    if not env_home:
        return native_home
    env_path = Path(env_home)
    try:
        env_path.resolve().relative_to(native_home.resolve())
        # Env override is under the native home (normal or profile mode).
        return native_home
    except ValueError:
        pass

    # Docker / custom deployment.
    # Check if this is a profile path: <root>/profiles/<name>
    # If the immediate parent dir is named "profiles", the root is the
    # grandparent — this covers Docker profiles correctly.
    if env_path.parent.name == "profiles":
        return env_path.parent.parent

    # Not a profile path — the env override itself is the root.
    return env_path


def get_optional_skills_dir(default: Path | None = None) -> Path:
    """Return the optional-skills directory, honoring package-manager wrappers.

    Packaged installs may ship ``optional-skills`` outside the Python package
    tree and expose it via ``NETCLAW_OPTIONAL_SKILLS`` (legacy alias
    ``HERMES_OPTIONAL_SKILLS`` is propagated automatically on import).
    """
    override = (
        os.getenv("NETCLAW_OPTIONAL_SKILLS", "").strip()
        or os.getenv("HERMES_OPTIONAL_SKILLS", "").strip()
    )
    if override:
        return Path(override)
    if default is not None:
        return default
    return get_hermes_home() / "optional-skills"


def get_hermes_dir(new_subpath: str, old_name: str) -> Path:
    """Resolve a Hermes subdirectory with backward compatibility.

    New installs get the consolidated layout (e.g. ``cache/images``).
    Existing installs that already have the old path (e.g. ``image_cache``)
    keep using it — no migration required.

    Args:
        new_subpath: Preferred path relative to HERMES_HOME (e.g. ``"cache/images"``).
        old_name: Legacy path relative to HERMES_HOME (e.g. ``"image_cache"``).

    Returns:
        Absolute ``Path`` — old location if it exists on disk, otherwise the new one.
    """
    home = get_hermes_home()
    old_path = home / old_name
    if old_path.exists():
        return old_path
    return home / new_subpath


def display_hermes_home() -> str:
    """Return a user-friendly display string for the current NetClaw home.

    Uses ``~/`` shorthand for readability::

        default:  ``~/.netclaw``  (or ``~/.hermes`` on legacy installs)
        profile:  ``~/.netclaw/profiles/coder``
        custom:   ``/opt/netclaw-custom``

    Use this in **user-facing** print/log messages instead of hardcoding
    the path.  For code that needs a real ``Path``, use
    :func:`get_hermes_home` instead.
    """
    home = get_hermes_home()
    try:
        return "~/" + str(home.relative_to(Path.home()))
    except ValueError:
        return str(home)


def get_subprocess_home() -> str | None:
    """Return a per-profile HOME directory for subprocesses, or None.

    When ``{HERMES_HOME}/home/`` exists on disk, subprocesses should use it
    as ``HOME`` so system tools (git, ssh, gh, npm …) write their configs
    inside the Hermes data directory instead of the OS-level ``/root`` or
    ``~/``.  This provides:

    * **Docker persistence** — tool configs land inside the persistent volume.
    * **Profile isolation** — each profile gets its own git identity, SSH
      keys, gh tokens, etc.

    The Python process's own ``os.environ["HOME"]`` and ``Path.home()`` are
    **never** modified — only subprocess environments should inject this value.
    Activation is directory-based: if the ``home/`` subdirectory doesn't
    exist, returns ``None`` and behavior is unchanged.
    """
    hermes_home = os.getenv("HERMES_HOME")
    if not hermes_home:
        return None
    profile_home = os.path.join(hermes_home, "home")
    if os.path.isdir(profile_home):
        return profile_home
    return None


VALID_REASONING_EFFORTS = ("minimal", "low", "medium", "high", "xhigh")


def parse_reasoning_effort(effort: str) -> dict | None:
    """Parse a reasoning effort level into a config dict.

    Valid levels: "none", "minimal", "low", "medium", "high", "xhigh".
    Returns None when the input is empty or unrecognized (caller uses default).
    Returns {"enabled": False} for "none".
    Returns {"enabled": True, "effort": <level>} for valid effort levels.
    """
    if not effort or not effort.strip():
        return None
    effort = effort.strip().lower()
    if effort == "none":
        return {"enabled": False}
    if effort in VALID_REASONING_EFFORTS:
        return {"enabled": True, "effort": effort}
    return None


def is_termux() -> bool:
    """Return True when running inside a Termux (Android) environment.

    Checks ``TERMUX_VERSION`` (set by Termux) or the Termux-specific
    ``PREFIX`` path.  Import-safe — no heavy deps.
    """
    prefix = os.getenv("PREFIX", "")
    return bool(os.getenv("TERMUX_VERSION") or "com.termux/files/usr" in prefix)


_wsl_detected: bool | None = None


def is_wsl() -> bool:
    """Return True when running inside WSL (Windows Subsystem for Linux).

    Checks ``/proc/version`` for the ``microsoft`` marker that both WSL1
    and WSL2 inject.  Result is cached for the process lifetime.
    Import-safe — no heavy deps.
    """
    global _wsl_detected
    if _wsl_detected is not None:
        return _wsl_detected
    try:
        with open("/proc/version", "r") as f:
            _wsl_detected = "microsoft" in f.read().lower()
    except Exception:
        _wsl_detected = False
    return _wsl_detected


_container_detected: bool | None = None


def is_container() -> bool:
    """Return True when running inside a Docker/Podman container.

    Checks ``/.dockerenv`` (Docker), ``/run/.containerenv`` (Podman),
    and ``/proc/1/cgroup`` for container runtime markers.  Result is
    cached for the process lifetime.  Import-safe — no heavy deps.
    """
    global _container_detected
    if _container_detected is not None:
        return _container_detected
    if os.path.exists("/.dockerenv"):
        _container_detected = True
        return True
    if os.path.exists("/run/.containerenv"):
        _container_detected = True
        return True
    try:
        with open("/proc/1/cgroup", "r") as f:
            cgroup = f.read()
            if "docker" in cgroup or "podman" in cgroup or "/lxc/" in cgroup:
                _container_detected = True
                return True
    except OSError:
        pass
    _container_detected = False
    return False


# ─── Well-Known Paths ─────────────────────────────────────────────────────────


def get_config_path() -> Path:
    """Return the path to ``config.yaml`` under HERMES_HOME.

    Replaces the ``get_hermes_home() / "config.yaml"`` pattern repeated
    in 7+ files (skill_utils.py, hermes_logging.py, hermes_time.py, etc.).
    """
    return get_hermes_home() / "config.yaml"


def get_skills_dir() -> Path:
    """Return the path to the skills directory under HERMES_HOME."""
    return get_hermes_home() / "skills"


def get_env_path() -> Path:
    """Return the path to the ``.env`` file under HERMES_HOME."""
    return get_hermes_home() / ".env"


# ─── Network Preferences ─────────────────────────────────────────────────────


def apply_ipv4_preference(force: bool = False) -> None:
    """Monkey-patch ``socket.getaddrinfo`` to prefer IPv4 connections.

    On servers with broken or unreachable IPv6, Python tries AAAA records
    first and hangs for the full TCP timeout before falling back to IPv4.
    This affects httpx, requests, urllib, the OpenAI SDK — everything that
    uses ``socket.getaddrinfo``.

    When *force* is True, patches ``getaddrinfo`` so that calls with
    ``family=AF_UNSPEC`` (the default) resolve as ``AF_INET`` instead,
    skipping IPv6 entirely.  If no A record exists, falls back to the
    original unfiltered resolution so pure-IPv6 hosts still work.

    Safe to call multiple times — only patches once.
    Set ``network.force_ipv4: true`` in ``config.yaml`` to enable.
    """
    if not force:
        return

    import socket

    # Guard against double-patching
    if getattr(socket.getaddrinfo, "_hermes_ipv4_patched", False):
        return

    _original_getaddrinfo = socket.getaddrinfo

    def _ipv4_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        if family == 0:  # AF_UNSPEC — caller didn't request a specific family
            try:
                return _original_getaddrinfo(
                    host, port, socket.AF_INET, type, proto, flags
                )
            except socket.gaierror:
                # No A record — fall back to full resolution (pure-IPv6 hosts)
                return _original_getaddrinfo(host, port, family, type, proto, flags)
        return _original_getaddrinfo(host, port, family, type, proto, flags)

    _ipv4_getaddrinfo._hermes_ipv4_patched = True  # type: ignore[attr-defined]
    socket.getaddrinfo = _ipv4_getaddrinfo  # type: ignore[assignment]


OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_MODELS_URL = f"{OPENROUTER_BASE_URL}/models"

AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1"
