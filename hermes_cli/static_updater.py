"""Best-effort hot updater for bundled NetClaw Web UI files."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import threading
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path


REQUEST_TIMEOUT_SECONDS = 10
BUNDLE_SCHEMA_VERSION = 1
UPDATE_PATHS = (
    # webui/static was removed in favour of the React SPA at hermes_cli/web_dist/
    # (built from web/src/). New static-bundles published by the license server
    # should target hermes_cli/web_dist instead.
    "hermes_cli/web_dist",
    "webui/api",
    "agent/mcp_publish",
    "agent/mcp_intercept",
    "agent/mcp_wechat",
    "agent/mcp_crm",
)


def _log(message: str) -> None:
    print(f"[static-updater] {message}", file=sys.stderr)


def _netclaw_home() -> Path:
    override = os.getenv("NETCLAW_HOME") or os.getenv("HERMES_HOME")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".netclaw"


def _version_path() -> Path:
    return _netclaw_home() / "static-bundle.version"


def _staging_root() -> Path:
    return _netclaw_home() / "static-bundle-staging"


def current_version() -> str:
    """Read ~/.netclaw/static-bundle.version (single line, semver)."""
    try:
        value = _version_path().read_text(encoding="utf-8").splitlines()[0].strip()
    except (IndexError, OSError):
        return "0.0.0"
    return value or "0.0.0"


def static_root() -> Path:
    """Locate the directory that contains the bundled ``webui/`` folder."""
    override = os.getenv("NETCLAW_STATIC_ROOT")
    if override:
        return Path(override).expanduser()

    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass)

    return Path(__file__).resolve().parent.parent


def check_for_update(
    server_base: str, channel: str = "stable", timeout: int = 10
) -> dict | None:
    """Return the latest bundle manifest when the license server has an update."""
    try:
        params = urllib.parse.urlencode(
            {"current": current_version(), "channel": channel}
        )
        url = f"{server_base.rstrip('/')}/api/agent/static-bundle-check?{params}"
        req = urllib.request.Request(
            url,
            method="GET",
            headers={"User-Agent": "netclaw-agent-static-updater"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read() or b"{}")
        if not body.get("success") or not body.get("has_update"):
            return None
        latest = body.get("latest")
        if not isinstance(latest, dict):
            return None
        if str(latest.get("version") or "") == current_version():
            return None
        return latest
    except Exception as exc:
        _log(f"update check failed: {exc}")
        return None


def download_and_apply(latest: dict, server_base: str) -> bool:
    """Download, verify, and replace bundled ``webui/static`` and ``webui/api``."""
    version = str(latest.get("version") or "").strip()
    if not version:
        _log("update skipped: missing version")
        return False
    if version == current_version():
        _log(f"update skipped: already at {version}")
        return True

    root = static_root()
    webui_root = root / "webui"
    if (
        not webui_root.is_dir()
        or not _is_writable(root)
        or not _is_writable(webui_root)
    ):
        _log(f"update skipped: static root is not writable: {root}")
        return False

    staging_root = _staging_root()
    staging_root.mkdir(parents=True, exist_ok=True)
    tmp_zip = staging_root / f"{version}.zip"
    extract_dir = staging_root / version

    try:
        _download_bundle(_download_url(latest, server_base, version), tmp_zip, latest)
        actual = _sha256_file(tmp_zip)
        expected = str(latest.get("sha256") or "").lower()
        if actual.lower() != expected:
            _write_last_error(
                f"sha256 mismatch version={version} expected={expected} actual={actual}"
            )
            _log(f"sha256 mismatch for static bundle {version}")
            return False

        if extract_dir.exists():
            shutil.rmtree(extract_dir)
        extract_dir.mkdir(parents=True)
        _safe_extract(tmp_zip, extract_dir)
        if not _validate_manifest(extract_dir, version):
            _log(f"update skipped: invalid manifest for {version}")
            return False

        components = _bundle_components(extract_dir, root)
        if not components:
            _log(f"update skipped: bundle {version} has no webui/static or webui/api")
            return False

        stamp = str(int(time.time()))
        prepared = _prepare_component_dirs(components, stamp)
        rollback_entries: list[tuple[Path, Path | None]] = []
        try:
            _swap_component_dirs(prepared, stamp, rollback_entries)
            _write_version(version)
        except Exception:
            _rollback_swaps(rollback_entries)
            raise

        _cleanup_success(staging_root, extract_dir, tmp_zip, webui_root)
        _log(f"static bundle updated to {version}")
        return True
    except Exception as exc:
        _log(f"update failed for {version}: {exc}")
        return False


def background_check_loop(
    server_base: str, interval_seconds: int = 1800, channel: str = "stable"
):
    """Daemon thread loop for best-effort update checks."""
    interval = max(1, int(interval_seconds))
    while True:
        try:
            latest = check_for_update(server_base, channel=channel)
            if latest is not None:
                download_and_apply(latest, server_base)
        except BaseException as exc:
            _log(f"background update error: {exc}")
        try:
            time.sleep(interval)
        except BaseException as exc:
            _log(f"background sleep interrupted: {exc}")
            try:
                time.sleep(1)
            except BaseException:
                pass


def start_background(
    server_base: str, interval_seconds: int = 1800, channel: str = "stable"
) -> threading.Thread:
    """Launch the static updater daemon and return the thread handle."""
    thread = threading.Thread(
        target=background_check_loop,
        args=(server_base,),
        kwargs={"interval_seconds": interval_seconds, "channel": channel},
        daemon=True,
        name="netclaw-static-updater",
    )
    thread.start()
    return thread


def _is_writable(path: Path) -> bool:
    return path.exists() and os.access(path, os.W_OK)


def _download_url(latest: dict, server_base: str, version: str) -> str:
    url = str(latest.get("download_url") or "").strip()
    if not url:
        quoted = urllib.parse.quote(version, safe="")
        return f"{server_base.rstrip('/')}/downloads/static-bundle/{quoted}"
    if url.startswith("/"):
        return f"{server_base.rstrip('/')}{url}"
    return url


def _download_bundle(url: str, tmp_zip: Path, latest: dict) -> None:
    tmp_zip.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(
        url,
        method="GET",
        headers={"User-Agent": "netclaw-agent-static-updater"},
    )
    size_hint = int(latest.get("size_bytes") or 0)
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
        total = int(resp.headers.get("Content-Length") or size_hint or 0)
        downloaded = 0
        next_report = 10
        with tmp_zip.open("wb") as fh:
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                fh.write(chunk)
                downloaded += len(chunk)
                if total <= 0:
                    continue
                percent = int(downloaded * 100 / total)
                while next_report <= 100 and percent >= next_report:
                    _log(f"download {next_report}%")
                    next_report += 10


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_last_error(message: str) -> None:
    log_path = _staging_root() / "last-error.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(message.replace("\n", " ") + "\n", encoding="utf-8")


def _safe_extract(zip_path: Path, extract_dir: Path) -> None:
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            name = info.filename.replace("\\", "/")
            parts = [part for part in name.split("/") if part]
            if name.startswith("/") or ".." in parts:
                raise ValueError(f"unsafe zip path: {info.filename}")
        zf.extractall(extract_dir)


def _validate_manifest(extract_dir: Path, version: str) -> bool:
    manifest_path = extract_dir / ".bundle-manifest.json"
    if not manifest_path.exists():
        return True
    try:
        raw = manifest_path.read_text(encoding="utf-8").strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = json.loads(raw.splitlines()[0])
    except (IndexError, OSError, json.JSONDecodeError):
        return False

    if data.get("schema_version") != BUNDLE_SCHEMA_VERSION:
        return False
    if data.get("version") and str(data["version"]) != version:
        return False
    applies_to = data.get("applies_to")
    if not isinstance(applies_to, list):
        return False
    return all(item in UPDATE_PATHS for item in applies_to)


def _bundle_components(extract_dir: Path, root: Path) -> list[tuple[Path, Path]]:
    components: list[tuple[Path, Path]] = []
    for rel in UPDATE_PATHS:
        source = extract_dir / rel
        if source.is_dir():
            components.append((source, root / rel))
    return components


def _prepare_component_dirs(
    components: list[tuple[Path, Path]], stamp: str
) -> list[tuple[Path, Path]]:
    prepared: list[tuple[Path, Path]] = []
    for source, target in components:
        new_dir = target.with_name(f"{target.name}.new.{stamp}")
        if new_dir.exists():
            shutil.rmtree(new_dir)
        shutil.copytree(source, new_dir)
        prepared.append((new_dir, target))
    return prepared


def _swap_component_dirs(
    prepared: list[tuple[Path, Path]],
    stamp: str,
    rollback_entries: list[tuple[Path, Path | None]],
) -> None:
    for new_dir, target in prepared:
        old_dir = target.with_name(f"{target.name}.old.{stamp}")
        if old_dir.exists():
            shutil.rmtree(old_dir)
        old_for_rollback: Path | None = None
        if target.exists():
            _replace_dir(target, old_dir)
            old_for_rollback = old_dir
        rollback_entries.append((target, old_for_rollback))
        _replace_dir(new_dir, target)


def _replace_dir(source: Path, target: Path) -> None:
    try:
        os.replace(source, target)
    except OSError:
        time.sleep(0.1)
        os.replace(source, target)


def _write_version(version: str) -> None:
    path = _version_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".version.tmp")
    tmp.write_text(version + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _rollback_swaps(entries: list[tuple[Path, Path | None]]) -> None:
    for target, old_dir in reversed(entries):
        try:
            if old_dir is not None and old_dir.exists():
                if target.exists():
                    shutil.rmtree(target)
                shutil.copytree(old_dir, target)
            elif target.exists():
                shutil.rmtree(target)
        except Exception as exc:
            _log(f"rollback failed for {target}: {exc}")


def _cleanup_success(
    staging_root: Path, extract_dir: Path, tmp_zip: Path, webui_root: Path
) -> None:
    try:
        tmp_zip.unlink()
    except OSError:
        pass
    try:
        shutil.rmtree(extract_dir)
    except OSError:
        pass

    cutoff = time.time() - 86400
    for pattern in ("static.old.*", "api.old.*"):
        for path in webui_root.glob(pattern):
            try:
                if path.is_dir() and path.stat().st_mtime < cutoff:
                    shutil.rmtree(path)
            except OSError:
                pass

    try:
        if staging_root.exists() and not any(staging_root.iterdir()):
            staging_root.rmdir()
    except OSError:
        pass
