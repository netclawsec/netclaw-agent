# NetClaw Agent — macOS Packaging

This directory builds a signed + notarized `.dmg` containing `NetClaw Agent.app`
from the hermes-agent source tree.

## What you get

```
dist/NetClaw Agent.app           ← standalone macOS app
dist/NetClaw-Agent-0.10.0.dmg    ← signed, notarized, Gatekeeper-accepted
```

Double-clicking the app launches a native window (WKWebView) showing the
Hermes webui (Dashboard / Config / Skills / Sessions / Logs). Under the hood
it's `uvicorn` bound to `127.0.0.1:9119`, wrapped by `pywebview`.

## One-time setup

### 1. Install build-time dependencies

```bash
# Python build tooling
python3 -m pip install --user pyinstaller Pillow pywebview

# Native tooling
brew install create-dmg node
xcode-select --install   # if iconutil/codesign/notarytool are missing
```

### 2. Install your Developer ID certificate

Your login keychain must contain a **Developer ID Application** certificate.
Verify:

```bash
security find-identity -p codesigning -v
```

Expected output should contain a line like:

```
Developer ID Application: jianhan ma (G92A987222)
```

If missing, download it from
<https://developer.apple.com/account/resources/certificates/list> → create a
Developer ID Application cert → double-click the downloaded `.cer` to install.

### 3. Create an App-Specific Password for notarization

1. Go to <https://appleid.apple.com/account/manage>
2. Sign-In and Security → **App-Specific Passwords** → Generate
3. Label it "NetClaw Agent Notarization"
4. Copy the `xxxx-xxxx-xxxx-xxxx` string

### 4. Configure `.env.signing`

```bash
cp packaging/macos/.env.signing.example packaging/macos/.env.signing
# edit packaging/macos/.env.signing with your values
```

## Building

From the project root:

```bash
bash packaging/macos/build.sh
```

Takes ~6–12 minutes end-to-end (notarization queue time dominates).

The script runs through 8 stages and prints progress. You can skip any stage
via env vars, e.g. to iterate quickly without re-notarizing:

```bash
SKIP_NOTARIZE=1 SKIP_DMG=1 bash packaging/macos/build.sh
# → produces dist/NetClaw Agent.app only
```

## Debugging a failed build

| Symptom | Fix |
|---|---|
| `Signing identity not found` | Re-check `security find-identity` output and update `SIGNING_IDENTITY` in `.env.signing` |
| `PyInstaller: ModuleNotFoundError: xxx` at runtime | Add `xxx` to the `hiddenimports` list in `netclaw.spec` |
| `notarytool`: `Invalid` status | Run `xcrun notarytool log <submission-id> --apple-id … --team-id …` to see specific violations — usually a missing `--options runtime` on an inner binary |
| App crashes on launch with "damaged" dialog | DMG was not stapled; re-run `bash packaging/macos/sign_notarize.sh staple <dmg>` |
| `create-dmg`: icon size mismatch | Ensure `NetClawAgent.icns` includes all sizes (iconutil requires specific set, see `make_icns.py`) |

## File map

```
packaging/macos/
├── README.md                 — this file
├── build.sh                  — orchestrator (entry point)
├── sign_notarize.sh          — codesign / notarytool / stapler helpers
├── make_icns.py              — build .icns from LOGO_01.jpg
├── app_launcher.py           — .app's Python entry point (uvicorn + webview)
├── netclaw.spec              — PyInstaller recipe
├── Info.plist.template       — reference Info.plist (PyInstaller injects its own)
├── entitlements.plist        — hardened runtime entitlements
├── .env.signing.example      — credentials template
├── .env.signing              — (gitignored) real credentials
├── .gitignore
├── icon/
│   ├── NetClawAgent.icns     — (gitignored) final .icns
│   └── NetClawAgent.iconset/ — intermediate PNG set
└── tests/
    ├── test_plan.md          — 10-category QA checklist
    ├── test_launch.py        — unit / integration (pytest)
    ├── test_build.sh         — post-build smoke + signing verify
    ├── test_ui.py            — webview functional (Playwright)
    ├── test_compat.sh        — OS / arch / permissions
    └── test_install.sh       — DMG mount / install / uninstall
```

## Running the test suite

```bash
bash packaging/macos/tests/run_all.sh
```

Full detail in [tests/test_plan.md](tests/test_plan.md).

## Distribution

After `build.sh` succeeds you have a self-contained, signed, notarized DMG.
Upload it to your website or release hosting. End users can:

1. Download `NetClaw-Agent-X.Y.Z.dmg`
2. Double-click → drag `NetClaw Agent` to `Applications`
3. Double-click the app in `/Applications` → **no** "damaged/unverified
   developer" dialog (because of notarization)

## Updating the logo

Replace `/LOGO_01.jpg` at the project root, then:

```bash
FORCE_ICON=1 bash packaging/macos/build.sh
```

The script regenerates the `.icns` with squircle corners and rebundles.
