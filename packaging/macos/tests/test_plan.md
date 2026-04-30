# NetClaw Agent — macOS Test Plan

> Covers the 10 categories requested: Planning, Unit/Integration, UI/Functional,
> Performance, Compatibility, Security, Usability/Accessibility,
> Install/Distribution, Regression/Beta, and Other.

## Test execution

```bash
# Run everything sequentially
bash packaging/macos/tests/run_all.sh

# Individual categories
bash   packaging/macos/tests/test_build.sh        # §2, §6, §8
pytest packaging/macos/tests/test_launch.py       # §2 unit + integration
pytest packaging/macos/tests/test_ui.py           # §3, §7
bash   packaging/macos/tests/test_compat.sh       # §5
bash   packaging/macos/tests/test_install.sh      # §8
bash   packaging/macos/tests/test_perf.sh         # §4
```

All test commands return non-zero exit code on failure so they can be plugged
into CI. Human-in-the-loop items (e.g., "verify dark-mode visual") are listed
in §§7–9 and documented for manual review.

---

## §1 Test Planning & Preparation

**Scope:** The signed + notarized `NetClaw-Agent-X.Y.Z.dmg` and the
`NetClaw Agent.app` inside it, distributed outside the Mac App Store via
Developer ID.

**Out of scope:** App Store submission (`.pkg` + App Sandbox + MAS
entitlements). Python package testing — already covered by the project's
existing `pytest` suite under `tests/`.

### Test environments

| Target | Minimum | Notes |
|---|---|---|
| macOS Sequoia (15.x) | primary target | Current host |
| macOS Sonoma (14.x) | must-pass | via local VM / spare Mac |
| macOS Ventura (13.x) | should-pass | UTM / Parallels VM |
| Apple Silicon (arm64) | required | M1/M2/M3 |
| Intel (x86_64) | secondary | one test pass per release |
| RAM: 8 GB minimum | required | notarized build peak RAM ≈ 2 GB |
| Storage: 2 GB free | required | .app ≈ 350 MB, working data |

### Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Notarization rejects due to unsigned inner binary | high | `sign_notarize.sh::sign_app` walks every Mach-O recursively |
| Gatekeeper blocks DMG on first open | high | Notarization + stapling before release |
| Python bootloader missing runtime deps | medium | Runtime import smoke test in `test_launch.py` |
| Webview blank on launch | medium | `test_ui.py::test_webview_loads_dashboard` |
| High RAM usage from embedded Python | low | `test_perf.sh` baselines + alerts |

---

## §2 Unit & Integration Tests (`test_launch.py`)

Python-native (pytest). Covers the **launcher code path**, not hermes-agent
business logic (which has its own test suite).

| Test | Kind | What it verifies |
|---|---|---|
| `test_frozen_resource_dir_repo_fallback` | unit | `_frozen_resource_dir()` returns repo root when `sys._MEIPASS` unset |
| `test_setup_environment_exports_bundled_skills` | unit | env vars set correctly |
| `test_wait_for_port_returns_true_on_bound_socket` | unit | sock check succeeds within timeout |
| `test_wait_for_port_returns_false_on_timeout` | unit | timeout path |
| `test_app_launcher_imports_cleanly` | unit | `import app_launcher` raises nothing |
| `test_uvicorn_starts_on_port` | integration | real uvicorn bound to 127.0.0.1:9119 serves `/api/status` |
| `test_session_token_injected_into_html` | integration | GET `/` returns HTML containing the session token |
| `test_api_status_endpoint_returns_200` | integration | basic health check |
| `test_api_requires_auth_on_sensitive_routes` | integration | `/api/env/reveal` returns 401 without token |
| `test_netclaw_relay_chat_completion` | integration (opt-in) | when `NETCLAW_API_KEY` set, exercises `/api/chat` against the real gpt-5.4 relay |

## §3 UI & Functional Tests (`test_ui.py`)

Playwright-driven, operates against the local FastAPI server the app spins up.

| Test | What it verifies |
|---|---|
| `test_webview_loads_dashboard` | Root page renders; React bundle loads; no JS console errors |
| `test_dashboard_themes_render` | All 6 themes switchable via settings page |
| `test_config_save_roundtrip` | POST `/api/config` persists and reads back |
| `test_skills_list_shows_bundled` | `HERMES_BUNDLED_SKILLS` dir contents visible |
| `test_model_picker_lists_gpt54` | after pointing to NetClaw relay, model dropdown shows gpt-5.4 |
| `test_edge_cases_empty_session` | clean install — no crash when no sessions exist |
| `test_edge_cases_large_config_yaml` | 100 KB config saves/loads |

## §4 Performance Tests (`test_perf.sh`)

Uses `/usr/bin/time -l` + `ps` + Instruments CLI.

| Metric | Budget | Tool |
|---|---|---|
| Cold start → webview visible | ≤ 4 s | `time` wrapper |
| Peak RSS (60 s after start) | ≤ 550 MB | `ps -p <pid> -o rss` every 5s |
| Idle CPU (60 s after start) | ≤ 5% avg | `top -stats pid,cpu -l 12` |
| uvicorn /api/status p95 latency | ≤ 20 ms | `ab -n 500 -c 10` |
| Binary launch count (no zombies) | 1 uvicorn after quit | `pgrep -f uvicorn` after stop |

Run under low-memory condition by capping python process memory via
`launchctl limit` (manual step — documented in script).

## §5 Compatibility Tests (`test_compat.sh`)

| Test | Tool |
|---|---|
| `.app` runs under Rosetta 2 on Apple Silicon | `arch -x86_64 open` |
| `.app` runs natively on arm64 | default `open` |
| Minimum macOS enforced (12.0+) | `plutil -extract LSMinimumSystemVersion` |
| Dark mode render OK | `defaults write -g AppleInterfaceStyle Dark` + visual diff |
| Non-admin guest user launch | `dscl / -create /Users/_qatest` + `su -l _qatest -c 'open …'` (documented manual) |
| IPv6 localhost (::1) binding works | `HERMES_APP_HOST=::1 open` |
| Locale en_US + zh_CN | `LANG=zh_CN.UTF-8 open` — no crash |
| Universal binary check | `lipo -archs netclaw-agent` lists arm64 (and x86_64 if enabled) |

## §6 Security Tests (`test_build.sh::security_checks`)

Automated:

| Check | Command | Expected |
|---|---|---|
| Bundle is signed | `codesign --verify --deep --strict NetClaw Agent.app` | exit 0 |
| Hardened runtime enabled | `codesign -d --entitlements :- NetClaw\ Agent.app \| plutil -p -` | contains `cs.allow-jit`, NOT `cs.disable-executable-page-protection` |
| Notarization stapled | `stapler validate NetClaw-Agent-X.Y.Z.dmg` | "worked" |
| Gatekeeper accepts | `spctl -a -t open --context context:primary-signature -v <dmg>` | `source=Notarized Developer ID` |
| No hardcoded secrets | `grep -rE 'sk-[a-zA-Z0-9]{30,}' "$APP"` | no matches |
| Binds only to loopback | `lsof -i -P \| grep netclaw-agent` while running | only `127.0.0.1` / `::1` |

Manual:

- Verify on `/api/env/reveal` that token rotation works.
- Confirm API keys in `~/.hermes/.env` are stored with `0600` perms.
- Test that removing the network entitlement **breaks** localhost bind (sanity).

## §7 Usability & Accessibility Tests

Primarily manual — documented in a checklist (`test_ui.py` covers a11y subset
via Playwright's `a11y-accessibility` API).

| Item | Method | Pass criteria |
|---|---|---|
| Window controls follow HIG | visual | red/yellow/green traffic lights present and functional |
| VoiceOver reads main buttons | Cmd+F5 → Tab through UI | announces correct labels |
| Keyboard-only navigation | Tab / Shift-Tab / Enter | reach all interactive controls |
| High-contrast mode | System Settings → Accessibility → Display → Increase Contrast | UI still legible |
| Dynamic type (zoom) | Ctrl+scroll | layout reflows, no clipping |
| Dark mode | System Setting toggle | colors adapt (webui has dark theme) |
| Localization | `LANG=zh_CN.UTF-8` | Chinese text renders correctly |

## §8 Installation / Distribution Tests (`test_install.sh`)

| Test | Command | Expected |
|---|---|---|
| DMG mounts without password prompt | `hdiutil attach <dmg>` | mount point returned |
| Volume name "NetClaw Agent" | `diskutil info <vol>` | matches |
| Drag-to-Applications simulated | `cp -R "<mount>/NetClaw Agent.app" /Applications/` | app appears |
| First launch doesn't prompt "from internet" | `xattr -p com.apple.quarantine /Applications/NetClaw\ Agent.app` then launch | runs without blocking dialog (notarized) |
| Uninstall is clean | `rm -rf /Applications/NetClaw\ Agent.app; rm -rf ~/Library/Application\ Support/hermes-agent` | no leftover processes, LaunchAgents, log files |
| Reinstall over existing | overwrite + launch | config preserved |
| Mount from a fresh download simulates quarantine | `xattr -w com.apple.quarantine "0083;…;Safari;" <dmg>` | still launches (stapled) |

## §9 Regression & Beta Testing

**Automated regression:** `run_all.sh` gets called in CI on every commit to
`main` after a packaging-related change.

**Beta flow:**

1. Upload DMG to a private S3 / HTTPS endpoint.
2. Share with 3–5 external testers on different Macs.
3. Collect crash reports from `~/Library/Logs/DiagnosticReports/` tagged
   "netclaw-agent" or "NetClaw Agent".
4. Track issues in the repo; fix and re-build before promoting.

**Crash monitoring:**

- Local: Console.app → subsystem filter `com.netclaw.agent`.
- Remote (optional): integrate Sentry Python DSN at `hermes_cli/main.py:main()`
  gated behind `HERMES_CRASH_REPORTING=1`.

## §10 Other Specialized Tests

| Area | Test |
|---|---|
| **Data integrity** | Save 100 sessions → restart app → all sessions present and decryptable |
| **Time Machine** | `~/Library/Application Support/hermes-agent/` should NOT be excluded from backups |
| **Log files** | `tail -f ~/Library/Logs/netclaw-agent.log` updates during use |
| **App Review compliance** | Not going to MAS, but verify: no root privilege required, no automatic launch on login, no code downloaded from remote (`find .app -name '*.py' -newer /tmp/ref` = empty) |
| **Docs test** | README install instructions followed verbatim on a clean Mac succeed |
| **Port conflict** | Start another process on :9119 → second launch shows friendly error, not crash |
| **Clock skew** | System time off by 24 h → notarization ticket still validates (it's cached locally) |
| **Offline launch** | Disconnect network → app still starts + webui renders (LLM calls fail gracefully) |

---

## Pass criteria for release

A release build may ship **only** when every automated test in
`run_all.sh` exits 0, and the following manual checklist is signed off:

- [ ] Visual inspection of icon in Finder / Dock / About This Mac (squircle OK)
- [ ] Dark mode toggle doesn't break UI
- [ ] VoiceOver can navigate at least the main menu and the chat input
- [ ] Tested on at least one non-development Mac (Sonoma or Ventura)
- [ ] DMG downloaded via HTTPS and opened from Safari does not show "damaged" dialog

---

## Test data

- `test_ui.py::test_netclaw_relay_chat_completion` uses the NetClaw API relay
  (`https://api.netclawapi.com/cli/v1`) with a test account's API key.
  Key is loaded from `$NETCLAW_API_KEY` — **never hard-code.**
- Mock skills live at `packaging/macos/tests/fixtures/mock-skills/`.
