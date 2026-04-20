# PyArmor — License Drop-In for Full Obfuscation

The macOS build pipeline (`packaging/macos/build.sh`) runs
`packaging/macos/obfuscate.sh` before PyInstaller to protect the source
tree. Obfuscation scope depends on whether you have a registered PyArmor
license:

| Mode       | Files obfuscated                                     |
|------------|------------------------------------------------------|
| **Trial**  | `hermes_cli/license.py` only                         |
| **Paid**   | Entire `hermes_cli/` + top-level enforcement modules |

## Buying & installing a license

1. Visit https://pyarmor.dashingsoft.com/ (pick **Personal** ($95/yr) or
   **Basic** ($229/yr) depending on whether you need RFT / hardware
   binding).
2. You receive a `pyarmor-regfile-*.zip`.
3. **Drop the zip at one of the two locations below**:

```bash
# (a) Register permanently under this user account:
pyarmor reg /path/to/pyarmor-regfile-XXXX.zip

# (b) Or point the build at it via env var for CI / one-shot builds:
export PYARMOR_LICENSE_FILE=/path/to/pyarmor-regfile-XXXX.zip
packaging/macos/build.sh
```

Once registered, subsequent `obfuscate.sh` runs automatically detect the
upgraded scope and widen obfuscation to the whole `hermes_cli/` package.
No spec-file edits needed — the PyInstaller spec already pulls from the
overlay position both modes write to.
