#!/usr/bin/env bash
# DrawRace chaos test — kills an api pod during sustained load and verifies recovery.
#
# Prerequisites:
#   - kubectl access to the drawrace namespace (via kubeconfig or proxy)
#   - k6 installed (https://k6.io)
#   - The drawrace API is deployed and healthy
#
# Usage:
#   API=https://api.drawrace.ardenone.com ./load/chaos-test.sh
#
# The script:
#   1. Starts a background k6 load test at 500 RPS
#   2. Waits for steady state (30s)
#   3. Kills one api pod
#   4. Monitors recovery (checks health endpoint until 200)
#   5. Verifies error rate stayed below threshold
#   6. Cleans up

set -euo pipefail

API="${API:-https://api.drawrace.ardenone.com}"
KUBECONF="${KUBECONF:-}"
NS="drawrace"
ERROR_THRESHOLD=0.5  # max 50% error rate during chaos

echo "=== DrawRace Chaos Test ==="
echo "API: $API"
echo ""

# Resolve kubectl command
if [ -n "$KUBECONF" ]; then
  K_CMD="kubectl --kubeconfig=$KUBECONF"
else
  K_CMD="kubectl"
fi

# Check prerequisites
if ! command -v k6 &>/dev/null; then
  echo "ERROR: k6 not found. Install from https://k6.io"
  exit 1
fi

# Verify API is healthy before starting
echo "[1/6] Checking API health..."
if ! curl -sf "${API}/v1/health" | jq -e '.api.ok' >/dev/null; then
  echo "ERROR: API is not healthy. Aborting."
  exit 1
fi
echo "  API is healthy."

# Find api pods
echo "[2/6] Finding api pods..."
PODS=$($K_CMD get pods -n "$NS" -l app=drawrace-api -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true)
if [ -z "$PODS" ]; then
  echo "WARN: No api pods found via kubectl. Skipping pod kill, running load test only."
  POD_COUNT=0
else
  POD_COUNT=$(echo "$PODS" | wc -w)
  echo "  Found $POD_COUNT api pod(s): $PODS"
fi

# Start k6 load test in background
echo "[3/6] Starting k6 load test at 500 RPS..."
k6 run \
  --env API="$API" \
  --env HMAC_KEY="drawrace-dev-key-2026" \
  --out json=/tmp/drawrace-chaos-results.json \
  --summary-export=/tmp/drawrace-chaos-summary.json \
  --duration 120s \
  --vus 100 \
  --iterations 60000 \
  "$(dirname "$0")/submit.js" \
  > /tmp/drawrace-chaos-k6.log 2>&1 &
K6_PID=$!
echo "  k6 PID: $K6_PID"

# Wait for steady state
echo "[4/6] Waiting 30s for steady state..."
sleep 30

# Kill a pod
if [ "$POD_COUNT" -gt 0 ]; then
  VICTIM=$(echo "$PODS" | awk '{print $1}')
  echo "[5/6] Killing pod $VICTIM..."
  $K_CMD delete pod "$VICTIM" -n "$NS" --grace-period=5
  echo "  Pod killed. Kubernetes will reschedule."

  # Monitor recovery
  echo "  Waiting for API to recover..."
  RECOVERED=false
  for i in $(seq 1 30); do
    if curl -sf "${API}/v1/health" >/dev/null 2>&1; then
      RECOVERED=true
      echo "  API recovered after ${i}s."
      break
    fi
    sleep 2
  done

  if [ "$RECOVERED" = false ]; then
    echo "  WARN: API did not recover within 60s."
  fi
else
  echo "[5/6] Skipping pod kill (no pods found)."
fi

# Wait for k6 to finish
echo "[6/6] Waiting for k6 to finish..."
wait "$K6_PID" || true

# Check results
echo ""
echo "=== Results ==="
if [ -f /tmp/drawrace-chaos-summary.json ]; then
  FAIL_RATE=$(jq -r '.metrics.http_req_failed.values.rate // 1' /tmp/drawrace-chaos-summary.json)
  P95=$(jq -r '.metrics.http_req_duration.values["p(95)"] // 999999' /tmp/drawrace-chaos-summary.json)
  TOTAL_REQS=$(jq -r '.metrics.http_reqs.values.count // 0' /tmp/drawrace-chaos-summary.json)

  echo "  Total requests:  $TOTAL_REQS"
  echo "  Error rate:       $(echo "$FAIL_RATE * 100" | bc -l | head -c5)%"
  echo "  p95 latency:      ${P95}ms"

  # Check threshold
  PASS=true
  if [ "$(echo "$FAIL_RATE > $ERROR_THRESHOLD" | bc -l)" -eq 1 ]; then
    echo "  FAIL: Error rate exceeded ${ERROR_THRESHOLD}"
    PASS=false
  else
    echo "  PASS: Error rate within ${ERROR_THRESHOLD} threshold"
  fi

  if [ "$PASS" = true ]; then
    echo ""
    echo "=== Chaos test PASSED ==="
    exit 0
  else
    echo ""
    echo "=== Chaos test FAILED ==="
    exit 1
  fi
else
  echo "  No k6 summary found. Check /tmp/drawrace-chaos-k6.log."
  exit 1
fi
