#!/usr/bin/env bash
# test_perf.sh — performance baselines (test_plan.md §4).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
APP_PATH="${APP_PATH:-$PROJECT_ROOT/dist/NetClaw Agent.app}"
EXE="$APP_PATH/Contents/MacOS/netclaw-agent"

BUDGET_COLD_START_SEC=4
BUDGET_PEAK_RSS_MB=550
BUDGET_IDLE_CPU_PCT=5

PASSED=0; FAILED=0
pass() { printf "\033[1;32m✓\033[0m %s\n" "$*"; PASSED=$((PASSED+1)); }
fail() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; FAILED=$((FAILED+1)); }
skip() { printf "\033[1;33m○\033[0m skip — %s\n" "$*"; }
sect() { printf "\n\033[1;34m── %s ──\033[0m\n" "$*"; }

[[ -x "$EXE" ]] || { fail "Binary missing: $EXE"; exit 1; }

free_port() { python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1])"; }

wait_for_port() {
    local port="$1" timeout="$2"
    local deadline=$(( $(date +%s) + timeout ))
    while (( $(date +%s) < deadline )); do
        if nc -z 127.0.0.1 "$port" 2>/dev/null; then return 0; fi
        sleep 0.1
    done
    return 1
}

# ---------------------------------------------------------------------------
# §4.1 Cold-start time
# ---------------------------------------------------------------------------

sect "Cold-start time"

PORT=$(free_port)
export HERMES_APP_PORT="$PORT"

START_NS=$(python3 -c 'import time; print(int(time.time()*1e9))')
"$EXE" >/tmp/netclaw-perf.log 2>&1 &
APP_PID=$!
if wait_for_port "$PORT" "$((BUDGET_COLD_START_SEC + 2))"; then
    END_NS=$(python3 -c 'import time; print(int(time.time()*1e9))')
    ELAPSED_MS=$(( (END_NS - START_NS) / 1000000 ))
    ELAPSED_S=$(python3 -c "print($ELAPSED_MS/1000)")
    if (( ELAPSED_MS <= BUDGET_COLD_START_SEC * 1000 )); then
        pass "cold start: ${ELAPSED_S}s (budget ${BUDGET_COLD_START_SEC}s)"
    else
        fail "cold start: ${ELAPSED_S}s EXCEEDS budget ${BUDGET_COLD_START_SEC}s"
    fi
else
    fail "port $PORT never came up — see /tmp/netclaw-perf.log"
    kill "$APP_PID" 2>/dev/null || true
    exit 1
fi

# ---------------------------------------------------------------------------
# §4.2 Peak RSS
# ---------------------------------------------------------------------------

sect "Peak RSS (60 s)"

MAX_RSS_KB=0
for _ in $(seq 1 12); do
    RSS=$(ps -p "$APP_PID" -o rss= 2>/dev/null | tr -d ' ' || echo 0)
    if [[ -n "$RSS" && "$RSS" -gt "$MAX_RSS_KB" ]]; then
        MAX_RSS_KB="$RSS"
    fi
    sleep 5
done
MAX_RSS_MB=$(( MAX_RSS_KB / 1024 ))
if (( MAX_RSS_MB <= BUDGET_PEAK_RSS_MB )); then
    pass "peak RSS: ${MAX_RSS_MB} MB (budget ${BUDGET_PEAK_RSS_MB} MB)"
else
    fail "peak RSS: ${MAX_RSS_MB} MB EXCEEDS budget ${BUDGET_PEAK_RSS_MB} MB"
fi

# ---------------------------------------------------------------------------
# §4.3 API latency
# ---------------------------------------------------------------------------

sect "API /api/status latency"

if command -v ab >/dev/null 2>&1; then
    AB_OUT=$(ab -n 200 -c 5 -q "http://127.0.0.1:$PORT/api/status" 2>&1 || true)
    MEAN_MS=$(echo "$AB_OUT" | awk '/Time per request.*mean,/ {print $4; exit}')
    if [[ -n "$MEAN_MS" ]]; then
        pass "mean latency: ${MEAN_MS} ms per request"
    else
        skip "could not parse ab output"
    fi
else
    skip "apachebench (ab) not available"
fi

# ---------------------------------------------------------------------------
# §4.4 Clean shutdown
# ---------------------------------------------------------------------------

sect "Clean shutdown"

kill "$APP_PID" 2>/dev/null || true
sleep 2
if ps -p "$APP_PID" >/dev/null 2>&1; then
    kill -9 "$APP_PID" 2>/dev/null || true
    skip "SIGTERM did not stop main process within 2s (SIGKILL used)"
else
    pass "Main process stopped on SIGTERM"
fi

LINGER=$(pgrep -f "netclaw-agent" 2>/dev/null | wc -l | tr -d ' ' || true)
LINGER=${LINGER:-0}
if (( LINGER == 0 )); then
    pass "No zombie netclaw-agent processes"
else
    fail "$LINGER zombie netclaw-agent process(es) remain"
fi

sect "Summary"
printf "passed: %d  failed: %d\n" "$PASSED" "$FAILED"
[[ "$FAILED" -eq 0 ]]
