#!/usr/bin/env bash
# Launches the packaged Apple Silicon app and runs scripts/scenarios/ci.mjs against it.
set -uo pipefail
APP="$(ls -d release/*/mac-arm64/*.app | head -1)"
export E2E_EXE="$PWD/$APP/Contents/MacOS/LocalCode AI Studio"
export E2E_OUT="$RUNNER_TEMP/e2e" E2E_USER_DATA="$RUNNER_TEMP/profile"
node scripts/e2e.mjs ci > "$RUNNER_TEMP/ci.log" 2>&1
cat "$RUNNER_TEMP/ci.log"
if grep -q "CI CHECK PASSED" "$RUNNER_TEMP/ci.log"; then
  echo "::notice title=packaged app::$(grep -E 'sqlite|terminal|run:|knowledge|setup:' "$RUNNER_TEMP/ci.log" | tr '\n' ' ' | head -c 1500)"
  exit 0
fi
echo "::error title=packaged app run::$(tail -40 "$RUNNER_TEMP/ci.log" | head -c 3500 | sed ':a;N;$!ba;s/%/%25/g;s/\n/%0A/g')"
exit 1
