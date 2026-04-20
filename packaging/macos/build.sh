#!/usr/bin/env bash
# build.sh — one-shot local build of NetClaw Agent.dmg
#
# Stages:
#   0  preflight  : tools + env + signing identity present
#   1  webui      : npm install + npm run build -> hermes_cli/web_dist/
#   2  icon       : regenerate .icns from LOGO_01.jpg if missing/stale
#   3  pyinstall  : produce dist/NetClaw Agent.app
#   4  sign       : codesign inner binaries + .app with Developer ID
#   5  dmg        : create-dmg -> dist/NetClaw-Agent-<version>.dmg
#   6  signdmg    : codesign the DMG itself
#   7  notarize   : xcrun notarytool submit (--wait)
#   8  staple     : xcrun stapler staple + spctl accept verify
#
# Skip stages with env vars:
#   SKIP_NOTARIZE=1 SKIP_DMG=1 etc. (see main())
#
# Source .env.signing first (or set the vars in your shell) — see
# .env.signing.example.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

# --- configuration ---------------------------------------------------------

APP_NAME="${APP_NAME:-NetClaw Agent}"
BUNDLE_ID="${BUNDLE_ID:-com.netclaw.agent}"
VERSION="${VERSION:-$(python3 -c "import tomllib,sys; sys.stdout.write(tomllib.loads(open('pyproject.toml','rb').read().decode())['project']['version'])")}"

DIST_DIR="$PROJECT_ROOT/dist"
BUILD_DIR="$PROJECT_ROOT/build"
APP_PATH="$DIST_DIR/$APP_NAME.app"
DMG_PATH="$DIST_DIR/NetClaw-Agent-$VERSION.dmg"

# signing
: "${SIGNING_IDENTITY:=Developer ID Application: jianhan ma (G92A987222)}"
: "${APPLE_TEAM_ID:=G92A987222}"
# APPLE_ID + APPLE_APP_PASSWORD must be set for notarization

# --- helpers ---------------------------------------------------------------

log() { printf "\n\033[1;34m▶ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; }

load_env() {
    local env_file="$SCRIPT_DIR/.env.signing"
    if [[ -f "$env_file" ]]; then
        # shellcheck disable=SC1090
        set -a; source "$env_file"; set +a
        ok "Loaded $env_file"
    fi
}

# --- stages ----------------------------------------------------------------

stage_preflight() {
    log "Stage 0/8 · Preflight checks"

    for cmd in python3 npm codesign hdiutil xcrun; do
        command -v "$cmd" >/dev/null 2>&1 || { err "Missing tool: $cmd"; exit 1; }
    done

    python3 -c "import PyInstaller, PIL" 2>/dev/null || {
        err "Missing Python deps. Run: pip install pyinstaller Pillow"
        exit 1
    }

    # Developer ID certificate present?
    security find-identity -p codesigning -v | grep -q "$SIGNING_IDENTITY" || {
        err "Signing identity not found: $SIGNING_IDENTITY"
        err "Run: security find-identity -p codesigning -v"
        exit 1
    }

    # create-dmg available?
    command -v create-dmg >/dev/null 2>&1 || {
        err "create-dmg not found. Install: brew install create-dmg"
        exit 1
    }

    ok "Version: $VERSION"
    ok "Bundle ID: $BUNDLE_ID"
    ok "Signing: $SIGNING_IDENTITY"
}

stage_webui() {
    log "Stage 1/8 · Build webui (React + Vite)"
    if [[ -d "$PROJECT_ROOT/hermes_cli/web_dist" && "${SKIP_WEBUI_BUILD:-0}" == "1" ]]; then
        ok "Skip (SKIP_WEBUI_BUILD=1 and web_dist/ exists)"
        return
    fi
    pushd "$PROJECT_ROOT/web" >/dev/null
    if [[ ! -d node_modules ]]; then
        npm install --silent
    fi
    npm run build --silent
    popd >/dev/null
    ok "webui built → hermes_cli/web_dist/"
}

stage_icon() {
    log "Stage 2/8 · Regenerate app icon"
    local icns="$SCRIPT_DIR/icon/NetClawAgent.icns"
    local src="$PROJECT_ROOT/LOGO_01.jpg"

    if [[ ! -f "$src" ]]; then
        err "Logo not found: $src"
        exit 1
    fi

    if [[ -f "$icns" && "$icns" -nt "$src" && "${FORCE_ICON:-0}" != "1" ]]; then
        ok "Skip (up to date). Set FORCE_ICON=1 to regenerate."
        return
    fi

    python3 "$SCRIPT_DIR/make_icns.py" --input "$src" --output "$icns"
    ok "Icon → $icns"
}

stage_pyinstall() {
    log "Stage 3/8 · PyInstaller"
    rm -rf "$BUILD_DIR" "$APP_PATH"
    pyinstaller "$SCRIPT_DIR/netclaw.spec" --noconfirm --clean --distpath "$DIST_DIR" --workpath "$BUILD_DIR"

    [[ -d "$APP_PATH" ]] || { err "Expected $APP_PATH not found"; exit 1; }
    ok "Built $APP_PATH ($(du -sh "$APP_PATH" | cut -f1))"
}

stage_sign() {
    log "Stage 4/8 · Sign .app with Developer ID"
    if [[ "${SKIP_SIGN:-0}" == "1" ]]; then
        ok "Skip (SKIP_SIGN=1)"
        return
    fi

    bash "$SCRIPT_DIR/sign_notarize.sh" sign_app "$APP_PATH"
    ok "Signed + verified $APP_PATH"
}

stage_dmg() {
    log "Stage 5/8 · Create DMG"
    if [[ "${SKIP_DMG:-0}" == "1" ]]; then
        ok "Skip (SKIP_DMG=1)"
        return
    fi
    rm -f "$DMG_PATH"

    local background_arg=""
    if [[ -f "$SCRIPT_DIR/dmg_background.png" ]]; then
        background_arg="--background $SCRIPT_DIR/dmg_background.png"
    fi

    # shellcheck disable=SC2086
    create-dmg \
        --volname "$APP_NAME" \
        --window-size 540 380 \
        --icon-size 110 \
        --icon "$APP_NAME.app" 140 190 \
        --hide-extension "$APP_NAME.app" \
        --app-drop-link 400 190 \
        --no-internet-enable \
        $background_arg \
        "$DMG_PATH" "$APP_PATH"

    ok "DMG → $DMG_PATH ($(du -sh "$DMG_PATH" | cut -f1))"
}

stage_signdmg() {
    log "Stage 6/8 · Sign DMG"
    if [[ "${SKIP_DMG:-0}" == "1" ]]; then
        ok "Skip (SKIP_DMG=1)"
        return
    fi
    codesign --force --sign "$SIGNING_IDENTITY" "$DMG_PATH"
    codesign --verify --verbose=2 "$DMG_PATH"
    ok "Signed $DMG_PATH"
}

stage_notarize() {
    log "Stage 7/8 · Notarize with Apple"
    if [[ "${SKIP_NOTARIZE:-0}" == "1" || "${SKIP_DMG:-0}" == "1" ]]; then
        ok "Skip (SKIP_NOTARIZE=1 or SKIP_DMG=1)"
        return
    fi
    bash "$SCRIPT_DIR/sign_notarize.sh" notarize "$DMG_PATH"
}

stage_staple() {
    log "Stage 8/8 · Staple + verify"
    if [[ "${SKIP_NOTARIZE:-0}" == "1" || "${SKIP_DMG:-0}" == "1" ]]; then
        ok "Skip (SKIP_NOTARIZE=1 or SKIP_DMG=1)"
        return
    fi
    bash "$SCRIPT_DIR/sign_notarize.sh" staple "$DMG_PATH"
}

# --- main ------------------------------------------------------------------

main() {
    load_env

    stage_preflight
    stage_webui
    stage_icon
    if [[ "${SKIP_OBFUSCATE:-0}" == "1" ]]; then
        log "Stage 2.5/8 · PyArmor obfuscate (skipped via SKIP_OBFUSCATE=1)"
    else
        log "Stage 2.5/8 · PyArmor obfuscate"
        bash "$SCRIPT_DIR/obfuscate.sh"
    fi
    stage_pyinstall
    stage_sign
    stage_dmg
    stage_signdmg
    stage_notarize
    stage_staple

    log "Done 🎉"
    printf "App : %s\n" "$APP_PATH"
    printf "DMG : %s\n" "$DMG_PATH"
}

main "$@"
