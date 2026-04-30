# NetClaw build worker (半自动 per-tenant installer pipeline)

Single-shot Python script that pulls one queued build from the license
server, drives a Parallels Windows VM through `build.ps1`, uploads the
produced installer to Aliyun OSS, and reports a signed download URL back.

Re-invoked every 5 minutes by launchd.

## Files

| File | Purpose |
|---|---|
| `build_worker.py` | Main entry — claim → build → upload → report |
| `oss_uploader.py` | Stdlib OSS V1 signed PUT + presigned GET URL |
| `run-worker.sh`   | launchd wrapper; sources `~/.netclaw/build-worker.env` |
| `com.netclawsec.build-worker.plist` | launchd plist (5 min `StartInterval`) |

## One-time setup (macOS)

1. **Install Parallels** with a Windows 11 VM named `Windows 11`.
   - Inside the VM, install Inno Setup 6 (`iscc.exe` on PATH) + Python 3.11.
   - Map the macOS `~/workspace/netclaw-agent` directory as a shared folder.

2. **Create the env file** (mode 600, secrets only):
   ```sh
   mkdir -p ~/.netclaw
   cat > ~/.netclaw/build-worker.env <<'EOF'
   BUILD_WORKER_TOKEN=<same value as license-server BUILD_WORKER_TOKEN>
   OSS_ACCESS_KEY_ID=<RAM AK>
   OSS_ACCESS_KEY_SECRET=<RAM SK>
   EOF
   chmod 600 ~/.netclaw/build-worker.env
   ```

3. **Provision the OSS bucket**:
   - Bucket: `netclaw-installers` (cn-hangzhou, public-read disabled — we use signed URLs)
   - RAM user: `oss-installer-bot` with `AliyunOSSFullAccess` scoped to that one bucket
   - Lifecycle rule: delete objects after 90 days (older builds get garbage-collected)

4. **Install + start the launchd agent**:
   ```sh
   cp packaging/build-worker/com.netclawsec.build-worker.plist \
      ~/Library/LaunchAgents/
   launchctl load -w ~/Library/LaunchAgents/com.netclawsec.build-worker.plist
   ```

5. **Verify it runs** by enqueueing a test build from
   `/admin/tenant.html → 安装包 → 构建专属安装包`. Watch the log:
   ```sh
   tail -f ~/Library/Logs/netclaw-build-worker.log
   ```

## License-server side

The license-server must have `BUILD_WORKER_TOKEN` set in its env. Add to
`license-server/.env` (or your pm2/systemd unit):

```
BUILD_WORKER_TOKEN=<same value as the worker's env file>
BUILD_DEFAULT_LICENSE_SERVER=https://license.netclawsec.com.cn
```

The token is required — without it, `/api/internal/build-queue` returns
`503 build_worker_disabled`.

## How a build is dispatched

1. `tenant_admin` POSTs `/api/tenant/installer/builds` from the WebUI.
2. License-server snapshots the tenant's active departments + bundle
   metadata into an `installer_builds` row with status `pending`.
3. Within 5 min, this worker:
   - GETs `/api/internal/build-queue` → claims the row (status `building`)
   - writes `bundle.json` to a tmp dir under the shared mount
   - `prlctl exec "Windows 11" cmd /c powershell -File ...build.ps1
     -TenantSlug <slug> -BundleJson <guest-path> -Version <ver>`
   - PyInstaller emits `dist/<repo>/netclaw/...` and ISCC produces
     `dist/NetClaw-Agent-Setup-<slug>-<ver>.exe`
4. Worker uploads the .exe to `installers/<slug>/<basename>.exe` in OSS.
5. Worker generates a 24h signed URL and POSTs
   `/api/internal/build-queue/:id/upload` with the URL.
6. Tenant admin's UI polls `/api/tenant/installer/builds/:id` and sees
   `status: succeeded` + `download_url`.

If anything blows up (PyInstaller crash, ISCC failure, OSS 5xx), the
worker POSTs `/api/internal/build-queue/:id/fail` with a truncated
traceback. The tenant admin sees `status: failed` + `error` in the UI
and can retry by enqueueing a new build.

## Stale-build reaper

If a worker dies mid-build (Mac reboot, Parallels VM crash) the row
stays in `building` forever. The license server exposes
`POST /api/internal/build-queue/reap` which marks any row whose
`claimed_at` is more than 30 min old as `failed: build_timed_out`.

Run it from a separate launchd job or a cron, e.g.:

```sh
# crontab -e
*/15 * * * * curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  "$LICENSE_SERVER_URL/api/internal/build-queue/reap" > /dev/null
```

## Migrating to Stage 2 (GH Actions auto-build)

The plan reserves `worker_kind` on `installer_builds`. To switch over:

1. Add `gh_actions` worker kind: tenant builds default to `manual`, but
   we can let super-admin opt some tenants into `gh_actions` via a tenant
   flag.
2. A GH Actions Windows runner cron-pulls
   `/api/internal/build-queue?worker_kind=gh_actions` with its own bearer
   token.
3. This macOS worker continues handling `manual` only.
