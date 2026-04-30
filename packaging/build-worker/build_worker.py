"""NetClaw Agent build worker — runs on macOS, drives Parallels Windows VM.

Single-shot lifecycle (designed to be re-invoked by launchd every N minutes):
    1. GET <license_server>/api/internal/build-queue with worker bearer token.
    2. If 204 → no work, exit 0.
    3. Else write bundle.json to a tmp file *inside the Parallels shared folder*.
    4. prlctl exec "<vm>" --current-user "powershell -File <build.ps1> ..."
    5. Find produced installer .exe in dist/ → upload to OSS.
    6. POST .../upload with download_url, OR .../fail with error trace.

Failure handling: every uncaught error is reported back to the queue via
fail-route so the tenant admin sees the failure in the WebUI rather than the
job staying "building" forever (the reap-stale endpoint also catches that
case after 30 min).

Env knobs (all required unless noted):
    BUILD_WORKER_TOKEN          Bearer token; matches license-server side
    LICENSE_SERVER_URL          e.g. https://license.netclawsec.com.cn
    PARALLELS_VM_NAME           VM display name (e.g. "Windows 11")
    PARALLELS_SHARED_DIR_HOST   macOS path that maps to a Windows drive
    PARALLELS_SHARED_DIR_GUEST  Windows path of the same shared folder
    BUILD_REPO_GUEST            Windows path to the netclaw-agent repo root
    AGENT_VERSION               e.g. "0.10.0"
    OSS_ACCESS_KEY_ID           — see oss_uploader.OssConfig
    OSS_ACCESS_KEY_SECRET
    OSS_BUCKET
    OSS_ENDPOINT                (optional, defaults to oss-cn-hangzhou)
    OSS_OBJECT_PREFIX           (optional, default "installers/")
    BUILD_DOWNLOAD_TTL          (optional, default 86400 = 24h signed URL)
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import traceback
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from oss_uploader import OssClient, OssError


class WorkerError(RuntimeError):
    """Worker-internal misconfiguration; not the same as a job-level failure."""


@dataclass(frozen=True)
class WorkerConfig:
    license_server: str
    worker_token: str
    vm_name: str
    shared_host: Path
    shared_guest: str
    repo_guest: str
    agent_version: str
    oss_object_prefix: str
    download_ttl: int

    @classmethod
    def from_env(cls) -> "WorkerConfig":
        def need(name: str) -> str:
            v = os.environ.get(name)
            if not v:
                raise WorkerError(f"missing env {name}")
            return v

        shared_host = Path(need("PARALLELS_SHARED_DIR_HOST")).expanduser()
        if not shared_host.is_dir():
            raise WorkerError(
                f"PARALLELS_SHARED_DIR_HOST {shared_host} is not a directory"
            )

        return cls(
            license_server=need("LICENSE_SERVER_URL").rstrip("/"),
            worker_token=need("BUILD_WORKER_TOKEN"),
            vm_name=need("PARALLELS_VM_NAME"),
            shared_host=shared_host,
            shared_guest=need("PARALLELS_SHARED_DIR_GUEST").rstrip("\\/"),
            repo_guest=need("BUILD_REPO_GUEST").rstrip("\\/"),
            agent_version=need("AGENT_VERSION"),
            oss_object_prefix=os.environ.get("OSS_OBJECT_PREFIX", "installers/"),
            download_ttl=int(os.environ.get("BUILD_DOWNLOAD_TTL", "86400")),
        )


# ---------------------------------------------------------------------------
# License-server HTTP
# ---------------------------------------------------------------------------


def _request(
    cfg: WorkerConfig,
    method: str,
    path: str,
    body: dict | None = None,
    timeout: float = 30.0,
) -> tuple[int, dict | None]:
    url = f"{cfg.license_server}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, method=method, data=data)
    req.add_header("Authorization", f"Bearer {cfg.worker_token}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = resp.read()
            json_body = None
            if payload:
                try:
                    json_body = json.loads(payload)
                except json.JSONDecodeError:
                    json_body = None
            return resp.status, json_body
    except urllib.error.HTTPError as exc:
        try:
            json_body = json.loads(exc.read())
        except Exception:
            json_body = None
        return exc.code, json_body


def claim_next(cfg: WorkerConfig) -> dict | None:
    status, body = _request(cfg, "GET", "/api/internal/build-queue?worker_kind=manual")
    if status == 204:
        return None
    if status != 200 or not body or not body.get("success"):
        raise WorkerError(f"claim_next: unexpected response {status} {body!r}")
    return body["build"]


def report_success(cfg: WorkerConfig, build_id: str, download_url: str) -> None:
    status, body = _request(
        cfg,
        "POST",
        f"/api/internal/build-queue/{build_id}/upload",
        {"download_url": download_url},
    )
    if status != 200:
        raise WorkerError(f"upload report rejected: {status} {body!r}")


def report_failure(cfg: WorkerConfig, build_id: str, message: str) -> None:
    # Best-effort — we don't want a fail-report failure to mask the original
    # exception. Just log and move on.
    try:
        _request(
            cfg,
            "POST",
            f"/api/internal/build-queue/{build_id}/fail",
            {"error": message[:1500]},
        )
    except Exception as exc:  # pragma: no cover
        print(f"[worker] fail-report itself failed: {exc}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Parallels driver
# ---------------------------------------------------------------------------


def _guest_path(cfg: WorkerConfig, host_relative: str) -> str:
    """Convert a host path under shared_host to its Windows-side path."""
    return f"{cfg.shared_guest}\\{host_relative.replace('/', chr(92))}"


def run_windows_build(
    cfg: WorkerConfig,
    bundle_host_path: Path,
    tenant_slug: str,
) -> Path:
    """Drive the Windows build. Returns the host-side path of the produced .exe."""
    bundle_rel = bundle_host_path.relative_to(cfg.shared_host)
    # Build a Windows-style relative path from the repo root. PowerShell
    # was treating UNC bundle paths as a "provider-qualified" filesystem
    # path (Microsoft.PowerShell.Core\FileSystem::\\Mac\...) which then
    # fails Test-Path. Using a drive-letter-relative path (resolved after
    # cd \) avoids the provider rewrite entirely.
    bundle_guest_rel = "." + "\\" + str(bundle_rel).replace("/", chr(92))

    # The build.ps1 script writes to dist/<basename>.exe under the repo. We
    # mirror its naming scheme so we know where to find the artifact.
    basename = f"NetClaw-Agent-Setup-{tenant_slug}-{cfg.agent_version}"
    output_relpath_guest = f"{cfg.repo_guest}\\dist\\{basename}.exe"

    # Drop a per-build wrapper batch into the repo dist/ dir. Doing it
    # this way side-steps two PowerShell-on-Windows-via-prlctl footguns:
    #   * `powershell -File \\UNC\path\script.ps1` confuses the parser
    #     and dies with "argument doesn't exist" before running anything.
    #   * Calling powershell with -Command inline + multiple quote layers
    #     gets re-quoted by cmd / prlctl and breaks subtly.
    # The .bat maps the X: drive (pre-configured Parallels share pointing
    # at the repo root), cd's to its root, and invokes build.ps1 with
    # both -File and -BundleJson as drive-letter-relative paths.
    wrapper_dir = cfg.shared_host / "dist"
    wrapper_dir.mkdir(parents=True, exist_ok=True)
    wrapper_path = wrapper_dir / f"build-worker-{tenant_slug}.bat"
    wrapper_path.write_text(
        "@echo off\r\n"
        "chcp 65001 > nul\r\n"
        "X:\r\n"
        "cd \\\r\n"
        "powershell -NoProfile -ExecutionPolicy Bypass "
        f"-File .\\packaging\\windows\\build.ps1 "
        f"-TenantSlug {tenant_slug} "
        f'-BundleJson "{bundle_guest_rel}" '
        f"-Version {cfg.agent_version}\r\n"
        "exit /b %errorlevel%\r\n",
        encoding="utf-8",
    )
    wrapper_guest = f"{cfg.shared_guest}\\dist\\build-worker-{tenant_slug}.bat"

    cmd = [
        "/usr/local/bin/prlctl",
        "exec",
        cfg.vm_name,
        "--current-user",
        "cmd.exe",
        "/c",
        wrapper_guest,
    ]
    print(f"[worker] running: {' '.join(cmd)}")
    completed = subprocess.run(cmd, capture_output=True, text=True, timeout=30 * 60)
    # Best-effort cleanup of the wrapper; not fatal if it sticks around.
    try:
        wrapper_path.unlink()
    except OSError:
        pass
    if completed.returncode != 0:
        raise WorkerError(
            f"prlctl build returned {completed.returncode}\n"
            f"STDOUT:\n{completed.stdout[-2000:]}\n"
            f"STDERR:\n{completed.stderr[-2000:]}"
        )

    # Map the guest output path back to the host shared mount. Build.ps1 must
    # be configured to drop output under the shared dir; we compute it via
    # string-substitution.
    if not output_relpath_guest.startswith(cfg.shared_guest + "\\"):
        raise WorkerError(
            f"build output path {output_relpath_guest!r} not under shared "
            f"folder {cfg.shared_guest!r}; check BUILD_REPO_GUEST setting"
        )
    rel = output_relpath_guest[len(cfg.shared_guest) + 1 :].replace("\\", "/")
    host_artifact = cfg.shared_host / rel
    if not host_artifact.is_file():
        raise WorkerError(f"expected installer at {host_artifact} but file missing")
    return host_artifact


# ---------------------------------------------------------------------------
# Main loop (single-shot)
# ---------------------------------------------------------------------------


def process_one(cfg: WorkerConfig) -> bool:
    """Process at most one job. Returns True if a job was attempted, False if idle."""
    job = claim_next(cfg)
    if not job:
        return False

    build_id = job["id"]
    bundle = job["bundle_json"] or {}
    tenant_slug = bundle.get("tenant_slug")
    if not tenant_slug:
        report_failure(cfg, build_id, "bundle.tenant_slug missing")
        return True

    tmpdir = Path(tempfile.mkdtemp(prefix="ncbw-", dir=str(cfg.shared_host)))
    try:
        bundle_path = tmpdir / "bundle.json"
        bundle_path.write_text(json.dumps(bundle, ensure_ascii=False), encoding="utf-8")

        try:
            artifact = run_windows_build(cfg, bundle_path, tenant_slug)
        except Exception as exc:
            tb = traceback.format_exc()
            report_failure(cfg, build_id, f"build failed: {exc}\n{tb}")
            return True

        try:
            object_key = f"{cfg.oss_object_prefix}{tenant_slug}/{artifact.name}"
            client = OssClient()
            client.put_file(
                object_key, artifact, content_type="application/x-msdownload"
            )
            signed = client.sign_get_url(
                object_key, expires_in_seconds=cfg.download_ttl
            )
        except OssError as exc:
            report_failure(cfg, build_id, f"OSS upload failed: {exc}")
            return True

        report_success(cfg, build_id, signed)
        return True
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def main() -> int:
    try:
        cfg = WorkerConfig.from_env()
    except WorkerError as exc:
        print(f"[worker] config error: {exc}", file=sys.stderr)
        return 2

    try:
        attempted = process_one(cfg)
    except WorkerError as exc:
        print(f"[worker] {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001
        print(
            f"[worker] unexpected error: {exc}\n{traceback.format_exc()}",
            file=sys.stderr,
        )
        return 1

    if not attempted:
        print("[worker] queue empty")
    return 0


if __name__ == "__main__":
    sys.exit(main())
