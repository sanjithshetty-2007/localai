#!/usr/bin/env bash
# Launches each packaged macOS app (Apple Silicon natively, Intel through Rosetta when
# available) and runs scripts/scenarios/ci.mjs against it.
set -uo pipefail
enc() { local m="${1:0:3500}"; m="${m//'%'/'%25'}"; m="${m//$'\r'/}"; printf '%s' "${m//$'\n'/'%0A'}"; }
FAILED=0

run_one() {
  local DIR="$1" LABEL="$2"
  local APP; APP="$(ls -d release/*/"$DIR"/*.app 2>/dev/null | head -1)"
  if [ -z "$APP" ]; then echo "::error title=$LABEL app::app bundle not found"; FAILED=1; return; fi
  export E2E_EXE="$PWD/$APP/Contents/MacOS/LocalCode AI Studio"
  export E2E_OUT="$RUNNER_TEMP/e2e-$LABEL" E2E_USER_DATA="$RUNNER_TEMP/profile-$LABEL"
  local LOG="$RUNNER_TEMP/ci-$LABEL.log"
  node scripts/e2e.mjs ci > "$LOG" 2>&1
  cat "$LOG"
  if grep -q "CI CHECK PASSED" "$LOG"; then
    echo "::notice title=$LABEL packaged app::$(enc "$(grep -E 'app |sqlite|terminal|run:|knowledge|setup:' "$LOG")")"
  else
    echo "::error title=$LABEL packaged app::$(enc "$(tail -40 "$LOG")")"
    FAILED=1
  fi
}

run_one mac-arm64 arm64
if arch -x86_64 /usr/bin/true 2>/dev/null; then
  run_one mac x64
else
  echo "::warning title=x64 packaged app::Rosetta is not available on this runner; the Intel app was not launched"
fi
exit $FAILED
