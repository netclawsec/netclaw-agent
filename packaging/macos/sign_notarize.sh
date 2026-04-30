#!/usr/bin/env bash
# sign_notarize.sh — helpers for signing, notarizing and stapling.
#
# Subcommands:
#   sign_app    <path-to-.app>   — deep-sign the bundle with hardened runtime
#   notarize    <path-to-file>   — upload to notarytool and wait for result
#   staple      <path-to-file>   — attach ticket + verify with spctl
#
# Required env (set in .env.signing):
#   APPLE_ID               Apple Developer account email
#   APPLE_APP_PASSWORD     App-specific password (NOT your main Apple ID password)
#   APPLE_TEAM_ID          Developer team ID (e.g., G92A987222)
#   SIGNING_IDENTITY       Common name of the Developer ID Application cert

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTITLEMENTS="$SCRIPT_DIR/entitlements.plist"

: "${SIGNING_IDENTITY:=Developer ID Application: jianhan ma (G92A987222)}"
: "${APPLE_TEAM_ID:=G92A987222}"

log() { printf "\033[1;34m▶ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; }

# ---- sign_app -------------------------------------------------------------

sign_app() {
    local app_path="$1"
    [[ -d "$app_path" ]] || { err "Not a bundle: $app_path"; exit 1; }
    [[ -f "$ENTITLEMENTS" ]] || { err "Missing entitlements: $ENTITLEMENTS"; exit 1; }

    log "Deep-signing $app_path"

    # Step 1: sign every inner binary (.dylib / .so / Mach-O executables) first.
    # Order matters: Apple requires that the outer container be signed LAST.
    find "$app_path" -type f \
        \( -name "*.dylib" -o -name "*.so" -o -name "Python" -o -perm +111 \) \
        2>/dev/null | while IFS= read -r f; do
        # Skip already-signed and non-Mach-O files
        if file "$f" 2>/dev/null | grep -q "Mach-O"; then
            codesign --force --timestamp --options runtime \
                --sign "$SIGNING_IDENTITY" "$f" 2>/dev/null || true
        fi
    done

    # Step 2: sign the bundle outer layer with entitlements.
    codesign --force --deep --timestamp --options runtime \
        --entitlements "$ENTITLEMENTS" \
        --sign "$SIGNING_IDENTITY" "$app_path"

    # Step 3: verify — strict + deep validation.
    codesign --verify --deep --strict --verbose=2 "$app_path"
    ok "Signature verified"

    # Step 4: check assessment — before notarization this will FAIL on "source=Unnotarized",
    # which is expected at this stage.
    if spctl --assess --type exec --verbose=2 "$app_path" 2>&1 | grep -q "accepted"; then
        ok "spctl accepts (already notarized)"
    else
        printf "\033[1;33m!\033[0m spctl: unnotarized (expected until notarize stage)\n"
    fi
}

# ---- notarize -------------------------------------------------------------

notarize() {
    local artifact="$1"
    [[ -f "$artifact" || -d "$artifact" ]] || { err "Missing $artifact"; exit 1; }

    : "${APPLE_ID:?APPLE_ID must be set (export or .env.signing)}"
    : "${APPLE_APP_PASSWORD:?APPLE_APP_PASSWORD must be set}"

    log "Submitting $(basename "$artifact") to notarytool"

    # For .app bundles, zip them first (notarytool accepts .zip, .dmg, .pkg only).
    local upload_path="$artifact"
    local tempzip=""
    if [[ -d "$artifact" && "$artifact" == *.app ]]; then
        tempzip="${artifact%.app}.zip"
        /usr/bin/ditto -c -k --keepParent "$artifact" "$tempzip"
        upload_path="$tempzip"
    fi

    local output
    output=$(xcrun notarytool submit "$upload_path" \
        --apple-id "$APPLE_ID" \
        --password "$APPLE_APP_PASSWORD" \
        --team-id "$APPLE_TEAM_ID" \
        --wait \
        --output-format json 2>&1)

    printf "%s\n" "$output"
    local status
    status=$(printf "%s" "$output" | /usr/bin/python3 -c 'import sys,json; d=json.loads(sys.stdin.read() or "{}"); print(d.get("status",""))' 2>/dev/null || echo "")

    if [[ "$status" != "Accepted" ]]; then
        err "Notarization failed (status=$status)"
        # Pull detailed log
        local submission_id
        submission_id=$(printf "%s" "$output" | /usr/bin/python3 -c 'import sys,json; d=json.loads(sys.stdin.read() or "{}"); print(d.get("id",""))' 2>/dev/null || echo "")
        if [[ -n "$submission_id" ]]; then
            err "Fetching submission log for $submission_id"
            xcrun notarytool log "$submission_id" \
                --apple-id "$APPLE_ID" \
                --password "$APPLE_APP_PASSWORD" \
                --team-id "$APPLE_TEAM_ID"
        fi
        [[ -n "$tempzip" && -f "$tempzip" ]] && rm -f "$tempzip"
        exit 1
    fi

    ok "Notarization Accepted"
    [[ -n "$tempzip" && -f "$tempzip" ]] && rm -f "$tempzip"
}

# ---- staple ---------------------------------------------------------------

staple() {
    local artifact="$1"
    [[ -e "$artifact" ]] || { err "Missing $artifact"; exit 1; }

    log "Stapling ticket to $artifact"
    xcrun stapler staple "$artifact"
    xcrun stapler validate "$artifact"

    if [[ "$artifact" == *.dmg ]]; then
        spctl -a -t open --context context:primary-signature -v "$artifact"
    elif [[ -d "$artifact" && "$artifact" == *.app ]]; then
        spctl --assess --type exec --verbose=2 "$artifact"
    fi

    ok "$artifact is notarized + stapled + Gatekeeper-accepted"
}

# ---- dispatcher -----------------------------------------------------------

case "${1:-}" in
    sign_app)  shift; sign_app "$@" ;;
    notarize)  shift; notarize "$@" ;;
    staple)    shift; staple "$@" ;;
    *)
        cat <<EOF
Usage: $0 <sign_app|notarize|staple> <artifact>

Subcommands:
  sign_app  <path.app>   Deep-sign the bundle with hardened runtime.
  notarize  <path>       Upload to notarytool and wait (.app, .dmg, .zip).
  staple    <path>       Attach notarization ticket + verify.

Required env vars (set in .env.signing):
  APPLE_ID, APPLE_APP_PASSWORD, APPLE_TEAM_ID, SIGNING_IDENTITY
EOF
        exit 2
        ;;
esac
