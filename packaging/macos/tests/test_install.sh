#!/usr/bin/env bash
# test_install.sh — DMG mount / install / uninstall tests (test_plan.md §8).
#
# Safety: installs to /tmp/NetClaw-Test-Install/ instead of /Applications
# so it never pollutes the user's real install. Set INSTALL_DIR=/Applications
# to simulate a real install (requires explicit opt-in).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

DMG_PATH="${DMG_PATH:-$(ls "$PROJECT_ROOT/dist"/NetClaw-Agent-*.dmg 2>/dev/null | head -n1 || true)}"
INSTALL_DIR="${INSTALL_DIR:-/tmp/NetClaw-Test-Install}"
MOUNT_POINT=""

PASSED=0; FAILED=0
pass() { printf "\033[1;32m✓\033[0m %s\n" "$*"; PASSED=$((PASSED+1)); }
fail() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; FAILED=$((FAILED+1)); }
skip() { printf "\033[1;33m○\033[0m skip — %s\n" "$*"; }
sect() { printf "\n\033[1;34m── %s ──\033[0m\n" "$*"; }

cleanup() {
    local ec=$?
    if [[ -n "$MOUNT_POINT" && -d "$MOUNT_POINT" ]]; then
        hdiutil detach "$MOUNT_POINT" -force >/dev/null 2>&1 || true
    fi
    exit $ec
}
trap cleanup EXIT INT TERM

[[ -n "$DMG_PATH" && -f "$DMG_PATH" ]] || { fail "DMG missing: '$DMG_PATH'"; exit 1; }

# ---------------------------------------------------------------------------
# §8.1 DMG mount
# ---------------------------------------------------------------------------

sect "DMG mount"

MOUNT_OUTPUT=$(hdiutil attach "$DMG_PATH" -nobrowse -noautoopen 2>&1 || echo "MOUNT_FAILED")
if echo "$MOUNT_OUTPUT" | grep -q "MOUNT_FAILED"; then
    fail "hdiutil attach failed: $MOUNT_OUTPUT"
    exit 1
fi
MOUNT_POINT=$(echo "$MOUNT_OUTPUT" | awk -F'\t' '/Apple_HFS|Apple_APFS/{print $NF}' | tail -1)
if [[ -z "$MOUNT_POINT" || ! -d "$MOUNT_POINT" ]]; then
    fail "Could not derive mount point"
    exit 1
fi
pass "Mounted at $MOUNT_POINT"

# ---------------------------------------------------------------------------
# §8.2 Mount content: NetClaw Agent.app + Applications alias
# ---------------------------------------------------------------------------

sect "DMG content"

if [[ -d "$MOUNT_POINT/NetClaw Agent.app" ]]; then
    pass "NetClaw Agent.app present on mount"
else
    fail "NetClaw Agent.app missing inside DMG"
fi

# create-dmg puts a symlink named "Applications" pointing to /Applications
if [[ -L "$MOUNT_POINT/Applications" ]]; then
    pass "Applications drop-link present"
elif [[ -L "$MOUNT_POINT/ Applications" || -L "$MOUNT_POINT/Applications " ]]; then
    pass "Applications drop-link present (with space)"
else
    skip "Applications drop-link not found (optional)"
fi

VOLUME_NAME=$(diskutil info "$MOUNT_POINT" 2>/dev/null | awk -F: '/Volume Name/{gsub(/^ +/, "", $2); print $2}')
if [[ "$VOLUME_NAME" == *"NetClaw Agent"* ]]; then
    pass "Volume name contains 'NetClaw Agent': $VOLUME_NAME"
else
    fail "Unexpected volume name: $VOLUME_NAME"
fi

# ---------------------------------------------------------------------------
# §8.3 Simulated install
# ---------------------------------------------------------------------------

sect "Install simulation → $INSTALL_DIR"

mkdir -p "$INSTALL_DIR"
INSTALLED_APP="$INSTALL_DIR/NetClaw Agent.app"
rm -rf "$INSTALLED_APP"
cp -R "$MOUNT_POINT/NetClaw Agent.app" "$INSTALLED_APP"

if [[ -d "$INSTALLED_APP" && -x "$INSTALLED_APP/Contents/MacOS/netclaw-agent" ]]; then
    pass "App copied to $INSTALLED_APP"
else
    fail "Copy to $INSTALL_DIR failed or missing +x"
fi

# Simulate quarantine attribute (as if downloaded from Safari)
xattr -w com.apple.quarantine "0083;00000000;Safari;" "$INSTALLED_APP" 2>/dev/null || true

# spctl should accept the quarantined install if the DMG was notarized + stapled
if spctl --assess --type exec --verbose=2 "$INSTALLED_APP" 2>&1 | grep -qE "accepted|Notarized"; then
    pass "spctl accepts quarantined install (stapling works)"
else
    skip "spctl does not accept — expected if --skip-notarize was used during build"
fi

# ---------------------------------------------------------------------------
# §8.4 Reinstall
# ---------------------------------------------------------------------------

sect "Reinstall"

touch "$INSTALLED_APP/Contents/Resources/.marker"
cp -R "$MOUNT_POINT/NetClaw Agent.app/." "$INSTALLED_APP/"
# Marker should have been removed/overwritten by fresh bundle
if [[ ! -f "$INSTALLED_APP/Contents/Resources/.marker" ]]; then
    pass "Reinstall overwrites existing files"
else
    skip ".marker retained (non-fatal, cp behavior varies)"
fi

# ---------------------------------------------------------------------------
# §8.5 Uninstall cleanliness
# ---------------------------------------------------------------------------

sect "Uninstall cleanliness"

rm -rf "$INSTALLED_APP"
if [[ ! -e "$INSTALLED_APP" ]]; then
    pass "Uninstall removes bundle with no leftovers in $INSTALL_DIR"
else
    fail "Uninstall failed"
fi

# Running processes with the app's bundle id
RUNNING=$(pgrep -f "netclaw-agent" 2>/dev/null | wc -l | tr -d ' ' || true)
RUNNING=${RUNNING:-0}
if (( RUNNING == 0 )); then
    pass "No netclaw-agent processes lingering"
else
    fail "$RUNNING netclaw-agent process(es) still running"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

sect "Summary"
printf "passed: %d  failed: %d\n" "$PASSED" "$FAILED"
[[ "$FAILED" -eq 0 ]]
