#!/bin/sh
# Wrapper for launchd. Loads ~/.netclaw/build-worker.env (which holds
# OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / BUILD_WORKER_TOKEN — the
# secrets that should NOT live in the plist) and execs build_worker.py.
#
# launchd's plist could in principle hold these in EnvironmentVariables,
# but plist files are world-readable under /Library/LaunchAgents/. Keeping
# secrets in a 600-mode env file is a smaller blast radius.

set -eu

ENV_FILE="${BUILD_WORKER_ENV_FILE:-$HOME/.netclaw/build-worker.env}"
if [ ! -f "$ENV_FILE" ]; then
    printf '[run-worker] missing env file %s\n' "$ENV_FILE" >&2
    exit 2
fi

# shellcheck disable=SC1090
. "$ENV_FILE"

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
exec /usr/bin/env python3 "$SCRIPT_DIR/build_worker.py"
