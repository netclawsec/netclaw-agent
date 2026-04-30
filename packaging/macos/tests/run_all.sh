#!/usr/bin/env bash
# run_all.sh — execute the full NetClaw Agent macOS test suite.
#
# Runs:
#   pytest  (test_launch.py + test_ui.py — unit + integration)
#   bash    (test_build.sh, test_compat.sh, test_install.sh, test_perf.sh)
#
# Exit 0 iff every stage passes.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$PROJECT_ROOT"

FAILED=()
START_TS=$(date +%s)

run() {
    local name="$1"; shift
    printf "\n\033[1;35m══════════ %s ══════════\033[0m\n" "$name"
    if "$@"; then
        printf "\033[1;32m══ %s PASSED ══\033[0m\n" "$name"
    else
        printf "\033[1;31m══ %s FAILED ══\033[0m\n" "$name"
        FAILED+=("$name")
    fi
}

# ---------------------------------------------------------------------------
# Static / unit
# ---------------------------------------------------------------------------

run "pytest-unit" \
    python3 -m pytest packaging/macos/tests/test_launch.py -v --tb=short \
    -k "not integration"

# ---------------------------------------------------------------------------
# Integration (requires a working hermes install in the current Python env)
# ---------------------------------------------------------------------------

if python3 -c "import fastapi, uvicorn" 2>/dev/null; then
    run "pytest-integration" \
        python3 -m pytest packaging/macos/tests/test_launch.py -v --tb=short \
        --run-integration -k "integration"
else
    printf "\n\033[1;33m○\033[0m skip pytest-integration (install hermes-agent[web] to enable)\n"
fi

# ---------------------------------------------------------------------------
# Built-bundle checks (require dist/NetClaw Agent.app)
# ---------------------------------------------------------------------------

if [[ -d "$PROJECT_ROOT/dist/NetClaw Agent.app" ]]; then
    run "test_build.sh"   bash packaging/macos/tests/test_build.sh
    run "test_compat.sh"  bash packaging/macos/tests/test_compat.sh
    run "test_perf.sh"    bash packaging/macos/tests/test_perf.sh

    if ls "$PROJECT_ROOT/dist"/NetClaw-Agent-*.dmg >/dev/null 2>&1; then
        run "test_install.sh" bash packaging/macos/tests/test_install.sh
    else
        printf "\n\033[1;33m○\033[0m skip test_install.sh (DMG missing)\n"
    fi
else
    printf "\n\033[1;33m○\033[0m skip .app-dependent tests (dist/NetClaw Agent.app missing — run build.sh)\n"
fi

# ---------------------------------------------------------------------------
# UI tests (optional)
# ---------------------------------------------------------------------------

if python3 -c "import playwright" 2>/dev/null; then
    run "pytest-ui" \
        python3 -m pytest packaging/macos/tests/test_ui.py -v --tb=short --run-integration
else
    printf "\n\033[1;33m○\033[0m skip pytest-ui (pip install playwright && playwright install chromium)\n"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

ELAPSED=$(( $(date +%s) - START_TS ))
printf "\n\033[1;34m════ total elapsed: %ds ════\033[0m\n" "$ELAPSED"

if (( ${#FAILED[@]} == 0 )); then
    printf "\033[1;32m✔ all test stages passed\033[0m\n"
    exit 0
else
    printf "\033[1;31m✘ failed stages (%d):\033[0m\n" "${#FAILED[@]}"
    for s in "${FAILED[@]}"; do printf "  - %s\n" "$s"; done
    exit 1
fi
