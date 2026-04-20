#!/usr/bin/env bash
# obfuscate.sh — run PyArmor against the NetClaw Agent source tree before
# PyInstaller bundles the .app.  Runs in two modes:
#
#   * Trial (default)           : obfuscates just the license enforcement
#                                 module.  Free, no ceiling on calls, but
#                                 limited file count per session.
#   * Paid / registered license : obfuscates the entire hermes_cli/ package
#                                 plus the top-level enforcement-adjacent
#                                 modules.  Trigger by either:
#                                   - having run `pyarmor reg <key.zip>`
#                                     under this user, OR
#                                   - exporting PYARMOR_LICENSE_FILE
#                                     pointing at your pyarmor-regfile zip
#                                     (the script runs `pyarmor reg` for
#                                      you when PYARMOR_LICENSE_FILE is set).
#
# Output: build/obf_stage/ mirrors the subset of the source tree that was
# obfuscated plus a sibling pyarmor_runtime_000000/ support package.  The
# calling build.sh overlays those back into the project root in place of
# the clear-text files before invoking PyInstaller.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

STAGE="$ROOT/build/obf_stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"

log() { printf "\n\033[1;34m▶ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
warn(){ printf "\033[1;33m!\033[0m %s\n" "$*" >&2; }

# --- Register the paid license file if PYARMOR_LICENSE_FILE is exported ---
if [[ -n "${PYARMOR_LICENSE_FILE:-}" ]]; then
    if [[ ! -f "$PYARMOR_LICENSE_FILE" ]]; then
        warn "PYARMOR_LICENSE_FILE=$PYARMOR_LICENSE_FILE not readable — falling back to trial"
    else
        log "Registering PyArmor license: $PYARMOR_LICENSE_FILE"
        pyarmor reg "$PYARMOR_LICENSE_FILE" >/dev/null
        ok  "PyArmor license registered"
    fi
fi

# --- Detect registered-vs-trial mode to decide the obfuscation footprint ---
PYARMOR_MODE="trial"
if pyarmor --version 2>&1 | grep -qv "trial"; then
    PYARMOR_MODE="registered"
fi

log "PyArmor mode: $PYARMOR_MODE"

if [[ "$PYARMOR_MODE" == "registered" ]]; then
    # Full obfuscation of the CLI + enforcement-adjacent top-level modules.
    # hermes_cli/ is the primary product IP surface; the top-level modules
    # referenced here implement home-dir resolution, license state paths,
    # time/crypto helpers and the run loop entry point.
    log "Obfuscating full hermes_cli + top-level modules"
    pyarmor gen -O "$STAGE" -r \
        hermes_cli \
        hermes_constants.py hermes_logging.py hermes_state.py hermes_time.py \
        run_agent.py trajectory_compressor.py
    ok  "Obfuscated $(find "$STAGE" -name '*.py' | wc -l | tr -d ' ') Python modules"
else
    # Trial: free edition caps files per session — only the license
    # enforcement module (the one that must NOT be bypassable by patching
    # .pyc bytecode) gets obfuscated.  Every other hermes_cli module goes
    # into the .app as regular .pyc inside the PyInstaller archive.
    log "Obfuscating license enforcement module only (trial PyArmor)"
    pyarmor gen -O "$STAGE" hermes_cli/license.py
    ok  "license.py obfuscated; 6-line pyarmor_runtime package generated"
fi

# --- Overlay the obfuscated files into the working tree so PyInstaller
#     picks them up without needing a separate staging source root. ---
log "Overlaying obfuscated modules into the working tree"
rm -rf "$ROOT/pyarmor_runtime_000000"
cp -r "$STAGE/pyarmor_runtime_000000" "$ROOT/"
ok  "pyarmor_runtime_000000/ installed at repo root"

if [[ -f "$STAGE/license.py" ]]; then
    # Trial-mode layout: pyarmor gen <file> produces a flat output.
    [[ -f "$ROOT/hermes_cli/license.py.clear" ]] || cp "$ROOT/hermes_cli/license.py" "$ROOT/hermes_cli/license.py.clear"
    cp "$STAGE/license.py" "$ROOT/hermes_cli/license.py"
    ok "hermes_cli/license.py replaced with obfuscated copy"
elif [[ -d "$STAGE/hermes_cli" ]]; then
    # Registered-mode layout: pyarmor gen -r <dir> mirrors structure.
    for f in $(find "$STAGE/hermes_cli" -name '*.py'); do
        rel="${f#$STAGE/}"
        [[ -f "$ROOT/$rel.clear" ]] || cp "$ROOT/$rel" "$ROOT/$rel.clear" 2>/dev/null || true
        cp "$f" "$ROOT/$rel"
    done
    for f in $(find "$STAGE" -maxdepth 1 -name '*.py' -not -name '__init__.py'); do
        base="$(basename "$f")"
        [[ -f "$ROOT/$base.clear" ]] || cp "$ROOT/$base" "$ROOT/$base.clear" 2>/dev/null || true
        cp "$f" "$ROOT/$base"
    done
    ok "overlay complete"
fi

log "Obfuscation stage done. Next: run packaging/macos/build.sh"
