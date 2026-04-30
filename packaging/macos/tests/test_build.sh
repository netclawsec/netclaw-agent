#!/usr/bin/env bash
# test_build.sh — post-build smoke + signing verification.
#
# Covers test_plan.md §2 partial, §6 (security checks), §8 (distribution).
# Exits 0 only if every assertion passes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
APP_PATH="${APP_PATH:-$PROJECT_ROOT/dist/NetClaw Agent.app}"
DMG_PATH="${DMG_PATH:-$(ls "$PROJECT_ROOT/dist"/NetClaw-Agent-*.dmg 2>/dev/null | head -n1 || true)}"

PASSED=0
FAILED=0

pass() { printf "\033[1;32m✓\033[0m %s\n" "$*"; PASSED=$((PASSED+1)); }
fail() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; FAILED=$((FAILED+1)); }
skip() { printf "\033[1;33m○\033[0m skip — %s\n" "$*"; }
sect() { printf "\n\033[1;34m── %s ──\033[0m\n" "$*"; }

# ---------------------------------------------------------------------------
# Bundle structure
# ---------------------------------------------------------------------------

sect "Bundle structure"

if [[ ! -d "$APP_PATH" ]]; then
    fail "App bundle missing: $APP_PATH  (run packaging/macos/build.sh first)"
    exit 1
fi
pass "App bundle present at $APP_PATH"

for path in "Contents/MacOS/netclaw-agent" "Contents/Resources/NetClawAgent.icns" "Contents/Info.plist"; do
    if [[ -e "$APP_PATH/$path" ]]; then
        pass "$path exists"
    else
        fail "$path missing"
    fi
done

# ---------------------------------------------------------------------------
# Info.plist essentials
# ---------------------------------------------------------------------------

sect "Info.plist metadata"

PLIST="$APP_PATH/Contents/Info.plist"
expect_plist() {
    local key="$1" expected="$2" actual
    actual=$(/usr/libexec/PlistBuddy -c "Print :$key" "$PLIST" 2>/dev/null || echo "")
    if [[ "$actual" == "$expected" ]]; then
        pass "$key = $expected"
    else
        fail "$key = '$actual' (expected '$expected')"
    fi
}

expect_plist "CFBundleIdentifier" "com.netclaw.agent"
expect_plist "LSMinimumSystemVersion" "12.0"
expect_plist "NSHighResolutionCapable" "true"

# ---------------------------------------------------------------------------
# Codesigning (§6)
# ---------------------------------------------------------------------------

sect "Code signing (§6)"

if codesign --verify --deep --strict "$APP_PATH" 2>/dev/null; then
    pass "codesign --verify --deep --strict passes"
else
    fail "codesign verification failed"
    codesign --verify --deep --strict --verbose=4 "$APP_PATH" 2>&1 | tail -10 >&2 || true
fi

# Hardened runtime entitlement check
if codesign -d --entitlements :- "$APP_PATH" 2>/dev/null | grep -q "com.apple.security.cs.allow-jit"; then
    pass "Hardened runtime entitlement com.apple.security.cs.allow-jit present"
else
    fail "Missing required entitlement: com.apple.security.cs.allow-jit"
fi

# Verify we did NOT ship an App Sandbox entitlement (incompatible)
if codesign -d --entitlements :- "$APP_PATH" 2>/dev/null | grep -q "com.apple.security.app-sandbox"; then
    fail "UNEXPECTED: com.apple.security.app-sandbox present (would block subprocess tools)"
else
    pass "No app-sandbox entitlement (correct for Developer ID distribution)"
fi

# ---------------------------------------------------------------------------
# Notarization (§6 + §8)
# ---------------------------------------------------------------------------

sect "Notarization & Gatekeeper (§8)"

if [[ -z "$DMG_PATH" ]]; then
    skip "No DMG found — skipping notarization checks"
else
    pass "DMG present at $DMG_PATH"

    if xcrun stapler validate "$DMG_PATH" 2>&1 | grep -q "worked"; then
        pass "stapler validate: ticket attached"
    else
        fail "DMG not stapled — users will see Gatekeeper warnings"
    fi

    if spctl -a -t open --context context:primary-signature -vv "$DMG_PATH" 2>&1 | grep -q "accepted"; then
        pass "spctl accepts DMG"
    else
        fail "spctl rejects DMG"
    fi

    if spctl --assess --type exec --verbose=2 "$APP_PATH" 2>&1 | grep -q "source=Notarized Developer ID"; then
        pass "spctl --assess: source=Notarized Developer ID"
    else
        skip "App not notarized yet (expected during --skip-notarize runs)"
    fi
fi

# ---------------------------------------------------------------------------
# Secret scanning (§6)
# ---------------------------------------------------------------------------

sect "Secret scanning"

if strings -n 32 "$APP_PATH/Contents/MacOS"/*netclaw-agent 2>/dev/null | grep -E '(sk-[A-Za-z0-9]{32,}|xoxb-[A-Za-z0-9-]{40,})' >/dev/null; then
    fail "Possible secret found inside main executable"
else
    pass "No obvious API keys in binary"
fi

# Scan Python files inside the bundle
if find "$APP_PATH" -name "*.py" -print0 2>/dev/null | xargs -0 grep -lE 'sk-[A-Za-z0-9]{32,}' 2>/dev/null | grep -v test_ | head -n1 >/dev/null; then
    fail "Hardcoded API key found in bundled .py files"
else
    pass "No hardcoded secrets in bundled .py files"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

sect "Summary"
printf "passed: %d  failed: %d\n" "$PASSED" "$FAILED"
[[ "$FAILED" -eq 0 ]]
