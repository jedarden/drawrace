#!/usr/bin/env bash
# DrawRace phone-smoke runner.
#
# Builds apps/web/dist, serves it over Tailscale on port 5180, confirms ADB,
# sets up CDP port-forwarding, opens Chrome on the Pixel 6, runs driver.py,
# then tears everything down.
#
# Usage:
#   bash e2e/phone-smoke/run.sh                    # build + serve + smoke
#   bash e2e/phone-smoke/run.sh --save-baselines   # capture new baselines
#   bash e2e/phone-smoke/run.sh --skip-build       # skip pnpm build (use existing dist)
#
# To point at an existing preview instead of a local server:
#   PHONE_SMOKE_URL=https://abc123.drawrace.pages.dev bash e2e/phone-smoke/run.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

SCRIPT_DIR="e2e/phone-smoke"
ARTIFACTS_DIR="$SCRIPT_DIR/artifacts"
BASELINE_DIR="$SCRIPT_DIR/baselines"
PORT=5180
CDP_PORT=9222
TAILSCALE_IP="100.72.170.64"

SKIP_BUILD=false
DRIVER_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    *) DRIVER_ARGS+=("$arg") ;;
  esac
done

# Prefer externally supplied URL; otherwise use local Tailscale server
URL="${PHONE_SMOKE_URL:-http://${TAILSCALE_IP}:${PORT}/?seed=1}"

SERVER_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Stopping HTTP server (pid $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  adb forward --remove tcp:$CDP_PORT 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 1. Confirm ADB connection
echo "=== Checking ADB connection ==="
if ! adb-check; then
  echo "FAIL: ADB not connected.  Run: adb-connect <port>"
  exit 1
fi

# 2. Build (unless skipped or using an external URL)
if [[ "$SKIP_BUILD" == "false" && -z "${PHONE_SMOKE_URL:-}" ]]; then
  echo "=== Building app ==="
  pnpm build
fi

# 3. Serve apps/web/dist on 0.0.0.0:$PORT
if [[ -z "${PHONE_SMOKE_URL:-}" ]]; then
  echo "=== Serving apps/web/dist on 0.0.0.0:$PORT ==="
  (cd apps/web/dist && python3 -m http.server $PORT --bind 0.0.0.0) &
  SERVER_PID=$!

  # Wait for the server to accept connections
  for i in $(seq 1 20); do
    if curl -sf -o /dev/null "http://localhost:$PORT/" 2>/dev/null; then
      echo "    Server ready at $URL"
      break
    fi
    sleep 0.5
  done
fi

# 4. Set up CDP port forwarding
echo "=== Setting up CDP port forward ==="
adb forward tcp:$CDP_PORT localabstract:chrome_devtools_remote

# 5. Launch Chrome to the preview URL
echo "=== Launching Chrome on phone ==="
adb shell am force-stop com.android.chrome 2>/dev/null || true
sleep 1
adb shell am start -a android.intent.action.VIEW \
    -d "$URL" \
    com.android.chrome

# Give Chrome time to open and start loading
echo "    Waiting for page to load..."
sleep 5

# 6. Run the CDP driver
echo "=== Running phone-smoke driver ==="
mkdir -p "$ARTIFACTS_DIR"
if [[ ${#DRIVER_ARGS[@]} -gt 0 ]]; then
  python3 "$SCRIPT_DIR/driver.py" \
    --url "$URL" \
    --artifacts "$ARTIFACTS_DIR" \
    --baseline-dir "$BASELINE_DIR" \
    "${DRIVER_ARGS[@]}"
else
  python3 "$SCRIPT_DIR/driver.py" \
    --url "$URL" \
    --artifacts "$ARTIFACTS_DIR" \
    --baseline-dir "$BASELINE_DIR"
fi
