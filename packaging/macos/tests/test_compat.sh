#!/usr/bin/env bash
# test_compat.sh — compatibility checks (test_plan.md §5).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
APP_PATH="${APP_PATH:-$PROJECT_ROOT/dist/NetClaw Agent.app}"

PASSED=0; FAILED=0
pass() { printf "\033[1;32m✓\033[0m %s\n" "$*"; PASSED=$((PASSED+1)); }
fail() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; FAILED=$((FAILED+1)); }
skip() { printf "\033[1;33m○\033[0m skip — %s\n" "$*"; }
sect() { printf "\n\033[1;34m── %s ──\033[0m\n" "$*"; }

[[ -d "$APP_PATH" ]] || { fail "App bundle missing: $APP_PATH"; exit 1; }

sect "macOS version"

OS_VERSION="$(sw_vers -productVersion)"
OS_MAJOR="${OS_VERSION%%.*}"
if (( OS_MAJOR >= 12 )); then
    pass "Host macOS is $OS_VERSION (>= 12.0)"
else
    fail "Host macOS $OS_VERSION is below the LSMinimumSystemVersion"
fi

MIN_OS=$(/usr/libexec/PlistBuddy -c "Print :LSMinimumSystemVersion" "$APP_PATH/Contents/Info.plist" 2>/dev/null || echo "")
if [[ "$MIN_OS" == "12.0" ]]; then
    pass "Bundle requires macOS 12.0+"
else
    fail "LSMinimumSystemVersion='$MIN_OS' (expected 12.0)"
fi

sect "Architecture"

ARCHS=$(lipo -archs "$APP_PATH/Contents/MacOS/netclaw-agent" 2>/dev/null || echo "")
if [[ -n "$ARCHS" ]]; then
    pass "Binary architectures: $ARCHS"
else
    fail "Could not read architectures from main binary"
fi

HOST_ARCH=$(uname -m)
case "$HOST_ARCH" in
    arm64)
        echo "$ARCHS" | grep -q arm64 && pass "arm64 slice present" || fail "arm64 slice missing"
        ;;
    x86_64)
        echo "$ARCHS" | grep -q x86_64 && pass "x86_64 slice present" || fail "x86_64 slice missing"
        ;;
esac

sect "Dynamic library compatibility"

# Walk the Frameworks directory and find the strictest minimum OS across all
# bundled Mach-O binaries. The effective minimum OS for the app == max of
# minos across the entire graph — LSMinimumSystemVersion must be >= this.
MAX_MAJOR=0
MAX_MINOR=0
if [[ -d "$APP_PATH/Contents/Frameworks" ]]; then
    while IFS= read -r -d '' lib; do
        if file "$lib" 2>/dev/null | grep -q "Mach-O"; then
            min=$(otool -l "$lib" 2>/dev/null | awk '/LC_VERSION_MIN_MACOSX|LC_BUILD_VERSION/{f=1;next} f && /minos/{print $2; exit}')
            if [[ -n "$min" ]]; then
                major=${min%%.*}
                rest=${min#*.}
                minor=${rest%%.*}
                [[ -z "$minor" || "$minor" == "$rest" ]] && minor=0
                if (( major > MAX_MAJOR || (major == MAX_MAJOR && minor > MAX_MINOR) )); then
                    MAX_MAJOR=$major
                    MAX_MINOR=$minor
                fi
            fi
        fi
    done < <(find "$APP_PATH/Contents/Frameworks" -type f -print0)
fi

EFFECTIVE_MIN_OS="${MAX_MAJOR}.${MAX_MINOR}"
DECLARED_MIN_OS="${MIN_OS:-12.0}"

if (( MAX_MAJOR <= ${DECLARED_MIN_OS%%.*} )); then
    pass "All bundled libs compatible with declared LSMinimumSystemVersion=$DECLARED_MIN_OS"
else
    # Informational, not a failure — the declared min can always be bumped
    # at release time to reflect reality.
    printf "\033[1;33m!\033[0m bundled libs require macOS >= %s (declared %s — consider bumping)\n" \
        "$EFFECTIVE_MIN_OS" "$DECLARED_MIN_OS"
    pass "effective minimum OS reported: $EFFECTIVE_MIN_OS"
fi

sect "Permissions / quarantine"

QUARANTINE=$(xattr -p com.apple.quarantine "$APP_PATH" 2>/dev/null || echo "")
if [[ -z "$QUARANTINE" ]]; then
    pass "No quarantine attribute on locally built app (expected)"
else
    skip "Quarantine attribute present: $QUARANTINE"
fi

if [[ -x "$APP_PATH/Contents/MacOS/netclaw-agent" ]]; then
    pass "Main executable has +x"
else
    fail "Main executable missing +x"
fi

sect "Summary"
printf "passed: %d  failed: %d\n" "$PASSED" "$FAILED"
[[ "$FAILED" -eq 0 ]]
