#!/usr/bin/env bash
# Verifies the packaged macOS apps: code signature + native modules (SQLite, terminal)
# for Apple Silicon and Intel. Failures are reported as GitHub annotations.
set -uo pipefail

FAILED=0
enc() { local m="${1:0:3000}"; m="${m//'%'/'%25'}"; m="${m//$'\r'/}"; printf '%s' "${m//$'\n'/'%0A'}"; }
note() { echo "::notice title=$1::$(enc "$2")"; }
fail() { echo "::error title=$1::$(enc "$2")"; FAILED=1; }

check_app() {
  local APP="$1" ARCHCMD="$2" LABEL="$3"
  if [ ! -d "$APP" ]; then fail "$LABEL app missing" "$(ls -R release | head -50)"; return; fi
  local OUT
  OUT=$(codesign --verify --deep --strict --verbose=2 "$APP" 2>&1) || fail "$LABEL codesign verify" "$OUT"
  note "$LABEL signature" "$(codesign -dv "$APP" 2>&1 | grep -E '^(Identifier|Format|Signature|TeamIdentifier|CodeDirectory)' )"
  local BIN="$APP/Contents/MacOS/LocalCode AI Studio"
  # Load modules through app.asar exactly like the app does (Electron redirects .node files to app.asar.unpacked).
  local M="$APP/Contents/Resources/app.asar/node_modules"
  note "$LABEL unpacked modules" "$(ls "$APP/Contents/Resources/app.asar.unpacked/node_modules/@lydell" 2>&1 | tr '\n' ' ')"
  OUT=$(ELECTRON_RUN_AS_NODE=1 $ARCHCMD "$BIN" -e "
    const D = require('$M/better-sqlite3'); const db = new D(':memory:');
    db.exec('create virtual table t using fts5(x)'); console.log('sqlite ok', process.arch);
    const pty = require('$M/@lydell/node-pty');
    const t = pty.spawn('/bin/echo', ['pty ok'], {});
    let out = ''; t.onData(d => out += d);
    t.onExit(() => { if (!out.includes('pty ok')) { console.error('no pty output: ' + JSON.stringify(out)); process.exit(1) } console.log(out.trim()); process.exit(0) });
    setTimeout(() => { console.error('pty timeout'); process.exit(1) }, 10000);" 2>&1) && note "$LABEL native modules" "$OUT" || fail "$LABEL native modules" "$OUT"
}

ARM_APP="$(ls -d release/*/mac-arm64/*.app 2>/dev/null | head -1)"
X64_APP="$(ls -d release/*/mac/*.app 2>/dev/null | head -1)"
check_app "$ARM_APP" "" "arm64"
if arch -x86_64 /usr/bin/true 2>/dev/null; then
  check_app "$X64_APP" "arch -x86_64" "x64"
else
  note "x64" "Rosetta not available: checking signature and Intel binaries only"
  OUT=$(codesign --verify --deep --strict --verbose=2 "$X64_APP" 2>&1) || fail "x64 codesign verify" "$OUT"
  OUT=$(file "$X64_APP/Contents/Resources/app.asar.unpacked/node_modules/@lydell/node-pty-darwin-x64/prebuilds/darwin-x64/pty.node" 2>&1)
  echo "$OUT" | grep -q x86_64 || fail "x64 terminal binary" "$OUT"
fi
exit $FAILED
