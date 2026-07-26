#!/usr/bin/env bash
# DrawRace validator chaos test — plan.md §Testing 9, the *second* chaos job.
# (The first kills a drawrace-api pod and is handled by chaos-test.sh / chaos.js.)
#
# Kills the single drawrace-validator pod while non-ephemeral submissions are
# being generated, waits for a replacement pod to become Ready, then asserts:
#   1. the `drawrace:validate` Redis list drains (BRPOP consumer recovers) —
#      measured via the `drawrace_validator_queue_depth` Prometheus gauge the
#      api exposes at /v1/metrics (RBAC-independent, best-effort), AND
#   2. every submission the generator actually enqueued (HTTP 202) reaches a
#      terminal verdict (accepted/rejected) within a bounded window — i.e. no
#      submission is permanently lost.
#
# No-loss is the authoritative assertion: the api writes the submissions row to
# Postgres with status='pending_validation' *before* LPUSHing onto the queue
# (crates/api .../submissions.rs), so any tracked submission always has a row
# and the poll (GET /v1/submissions/{id}) returns a verdict once the validator
# processes it. A submission still pending after the drain window = lost.
#
# No-duplication is structural, not measured: BRPOP removes each entry
# atomically (a submission can never be processed twice) and submission_id is a
# UUID primary key (a row can only hold one verdict). We confirm the count of
# distinct resolved IDs equals the count of tracked submissions.
#
# The k6 generator (validator-chaos.js) logs
#     TRACKED_SUBMISSION <submission_id> <player_uuid>
# for each submission the api accepted (202). This script captures that stream
# and polls each one to a terminal verdict.
#
# Prerequisites:
#   - kubectl access to the drawrace namespace (via kubeconfig or proxy)
#   - k6 installed (https://k6.io), plus curl + jq
#   - The drawrace API + validator are deployed and healthy
#
# Usage:
#   API=https://api-drawrace.ardenone.com ./load/validator-chaos-test.sh
#
# Env:
#   API                    api base url (default https://api-drawrace.ardenone.com)
#   KUBECONF               kubeconfig path (optional; falls back to default kubeconfig)
#   NS                     namespace (default drawrace)
#   HMAC_KEY               client HMAC key (default drawrace-dev-key-2026)
#   CHAOS_DURATION         k6 generator duration (default: k6 script's 150s)
#   STEADY_STATE_SECS      seconds to generate before killing the pod (default 25)
#   REPLACEMENT_TIMEOUT    seconds to wait for a new Ready pod (default 180)
#   DRAIN_WINDOW_SECS      bounded window for all submissions to resolve (default 180)
#   POLL_INTERVAL_SECS     seconds between poll rounds (default 10 — stays under
#                          the api's 60/min per-UUID poll limit even with the
#                          generator's ~9 submissions for the busiest UUID)

set -euo pipefail

API="${API:-https://api-drawrace.ardenone.com}"
KUBECONF="${KUBECONF:-}"
NS="${NS:-drawrace}"
HMAC_KEY="${HMAC_KEY:-drawrace-dev-key-2026}"
STEADY_STATE_SECS="${STEADY_STATE_SECS:-25}"
REPLACEMENT_TIMEOUT="${REPLACEMENT_TIMEOUT:-180}"
DRAIN_WINDOW_SECS="${DRAIN_WINDOW_SECS:-180}"
POLL_INTERVAL_SECS="${POLL_INTERVAL_SECS:-10}"

K6_LOG="/tmp/drawrace-validator-chaos-k6.log"
POLL_BODY="/tmp/dr_vchaos_poll.json"

echo "=== DrawRace Validator Chaos Test ==="
echo "API: $API"
echo "namespace: $NS"
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
for tool in curl jq; do
  if ! command -v "$tool" &>/dev/null; then
    echo "ERROR: $tool not found."
    exit 1
  fi
done

# [1/8] Verify API health (and that a validator is reporting).
echo "[1/8] Checking API + validator health..."
HEALTH=$(curl -sf -m 10 "${API}/v1/health" 2>/dev/null || true)
if [ -z "$HEALTH" ]; then
  echo "ERROR: API is not healthy (no /v1/health response). Aborting."
  exit 1
fi
API_OK=$(echo "$HEALTH" | jq -r '.api.ok // false' 2>/dev/null || echo false)
VAL_OK=$(echo "$HEALTH" | jq -r '.validator.ok // false' 2>/dev/null || echo false)
PV=$(echo "$HEALTH" | jq -r '.validator.physics_version // "?"' 2>/dev/null || echo "?")
echo "  api.ok=$API_OK  validator.ok=$VAL_OK  physics_version=$PV"
if [ "$API_OK" != "true" ]; then
  echo "ERROR: API not healthy. Aborting."
  exit 1
fi
if [ "$VAL_OK" != "true" ]; then
  echo "WARN: validator not currently reporting ok — proceeding anyway (it is the SUT)."
fi

# [2/8] Find validator pods (single replica per validator-deployment.yaml).
echo "[2/8] Finding validator pods..."
PODS=$($K_CMD get pods -n "$NS" -l app=drawrace-validator -o jsonpath='{.items[*].metadata.name}' 2>&1) || PODS=""
if [[ "$PODS" == *"Forbidden"* ]] || [[ "$PODS" == *"Unauthorized"* ]] || [ -z "$PODS" ]; then
  echo "WARN: Cannot list validator pods ($PODS). Skipping pod kill; running drain assertion only."
  POD_COUNT=0
  KILL_POSSIBLE=false
else
  POD_COUNT=$(echo "$PODS" | wc -w)
  echo "  Found $POD_COUNT validator pod(s): $PODS"
  KILL_POSSIBLE=true
fi

# [3/8] Start the k6 generator (non-ephemeral submissions → enqueued on the
# drawrace:validate list). Each accepted submission is logged as
# TRACKED_SUBMISSION <id> <uuid> on stdout, captured to K6_LOG.
echo "[3/8] Starting k6 validator-chaos generator..."
K6_ARGS=(--env "API=$API" --env "HMAC_KEY=$HMAC_KEY")
# Pass the live physics version only when we read a clean integer; otherwise
# let the k6 script's own setup() read it from /v1/health (or default to 8).
if [[ "$PV" =~ ^[0-9]+$ ]]; then
  K6_ARGS+=(--env "PHYSICS_VERSION=$PV")
fi
if [ -n "${CHAOS_DURATION:-}" ]; then
  K6_ARGS+=(--env "CHAOS_DURATION=$CHAOS_DURATION")
fi
k6 run "${K6_ARGS[@]}" "$(dirname "$0")/validator-chaos.js" > "$K6_LOG" 2>&1 &
K6_PID=$!
echo "  k6 PID: $K6_PID"

# [4/8] Let submissions flow into the queue before introducing chaos.
echo "[4/8] Waiting ${STEADY_STATE_SECS}s for steady state..."
sleep "$STEADY_STATE_SECS"

# [5/8] Kill the validator pod and wait for a replacement to become Ready.
RECOVERED=false
REPLACEMENT=""
if [ "$KILL_POSSIBLE" = true ]; then
  VICTIM=$(echo "$PODS" | awk '{print $1}')
  echo "[5/8] Killing validator pod $VICTIM..."
  DELETE_RESULT=$($K_CMD delete pod "$VICTIM" -n "$NS" --grace-period=5 2>&1) || DELETE_RESULT=""
  if [[ "$DELETE_RESULT" == *"Forbidden"* ]] || [[ "$DELETE_RESULT" == *"Unauthorized"* ]] || [ -z "$DELETE_RESULT" ]; then
    echo "  WARN: Cannot delete pod ($DELETE_RESULT). Pod kill skipped; drain assertion still runs."
  else
    echo "  Pod killed. Waiting for a replacement to become Ready..."
    # Wait for the old pod to finish terminating, then for the (single) new pod.
    $K_CMD wait --for=delete "pod/$VICTIM" -n "$NS" --timeout=60s 2>/dev/null || true
    if $K_CMD wait pods -l app=drawrace-validator -n "$NS" \
        --for=condition=Ready --timeout="${REPLACEMENT_TIMEOUT}s" 2>/dev/null; then
      RECOVERED=true
    else
      # Fallback: poll for any *new* Ready pod distinct from the victim (handles
      # older kubectl / proxies where `kubectl wait` is unavailable).
      echo "  kubectl wait unavailable/unsuccessful; polling for a new Ready pod..."
      DEADLINE=$(( $(date +%s) + REPLACEMENT_TIMEOUT ))
      while [ "$(date +%s)" -lt "$DEADLINE" ]; do
        READY_PODS=$($K_CMD get pods -n "$NS" -l app=drawrace-validator \
          -o jsonpath='{.items[?(@.status.containerStatuses[0].ready==true)].metadata.name}' 2>/dev/null) || READY_PODS=""
        for p in $READY_PODS; do
          if [ "$p" != "$VICTIM" ]; then
            RECOVERED=true
            REPLACEMENT="$p"
            break
          fi
        done
        if [ "$RECOVERED" = true ]; then break; fi
        sleep 5
      done
    fi
    if [ "$RECOVERED" = true ]; then
      [ -z "$REPLACEMENT" ] && REPLACEMENT="(kubectl wait)"
      echo "  Replacement validator pod Ready: $REPLACEMENT"
    else
      echo "  WARN: No replacement validator pod became Ready within ${REPLACEMENT_TIMEOUT}s."
    fi
  fi
else
  echo "[5/8] Skipping pod kill (no pod access)."
fi

# [6/8] Let the generator finish so no new submissions arrive during the drain.
echo "[6/8] Waiting for k6 to finish..."
wait "$K6_PID" || true
K6_EXIT=$?
if [ "$K6_EXIT" -ne 0 ]; then
  echo "  WARN: k6 exited non-zero ($K6_EXIT). See $K6_LOG."
fi

# [7/8] Parse every submission the api actually enqueued (TRACKED_SUBMISSION).
echo "[7/8] Collecting tracked submissions..."
declare -A SUB_UUID=()
TRACKED_IDS=()
# Lines look like: INFO[0001] TRACKED_SUBMISSION <uuid-id> <player-uuid>
while read -r id uuid; do
  [ -z "$id" ] && continue
  if [ -z "${SUB_UUID[$id]:-}" ]; then
    SUB_UUID[$id]="$uuid"
    TRACKED_IDS+=("$id")
  fi
done < <(grep -oE 'TRACKED_SUBMISSION [0-9a-fA-F-]+ [0-9a-fA-F-]+' "$K6_LOG" 2>/dev/null | awk '{print $2, $3}')

TRACKED=${#TRACKED_IDS[@]}
echo "  Tracked (api-accepted, enqueued) submissions: $TRACKED"

# Poll one submission. Echoes its terminal status (accepted|rejected) or empty
# for any non-terminal outcome (pending_validation, 404, 429, 5xx, network). A
# 429 (poll rate limit) or transient 5xx simply retries next round.
poll_submission() {
  local sid="$1" uuid="$2" code
  code=$(curl -s -m 10 -o "$POLL_BODY" -w '%{http_code}' \
    -H "X-DrawRace-Player: $uuid" \
    "${API}/v1/submissions/${sid}" 2>/dev/null || echo '000')
  if [ "$code" = "200" ]; then
    jq -r '.status // empty' "$POLL_BODY" 2>/dev/null || echo ""
  else
    echo ""
  fi
}

# Best-effort queue depth from the api's Prometheus exposition.
# Returns "unknown" if /v1/metrics or the gauge is unavailable.
queue_depth() {
  local depth
  depth=$(curl -sf -m 5 "${API}/v1/metrics" 2>/dev/null \
    | awk '/^drawrace_validator_queue_depth /{print $2; exit}' || true)
  echo "${depth:-unknown}"
}

# [8/8] Drain window: poll every tracked submission to a terminal verdict and
# confirm the queue drains. Bounded by DRAIN_WINDOW_SECS.
echo "[8/8] Asserting queue drains within ${DRAIN_WINDOW_SECS}s (no permanent loss)..."
echo "  Queue depth at drain start: $(queue_depth)"

declare -A RESOLVED_STATUS=()
if [ "$TRACKED" -gt 0 ]; then
  DEADLINE=$(( $(date +%s) + DRAIN_WINDOW_SECS ))
  while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    all_done=true
    for id in "${TRACKED_IDS[@]}"; do
      [ -n "${RESOLVED_STATUS[$id]:-}" ] && continue
      st=$(poll_submission "$id" "${SUB_UUID[$id]}")
      case "$st" in
        accepted|rejected) RESOLVED_STATUS[$id]="$st" ;;
        *) all_done=false ;;
      esac
    done
    if [ "$all_done" = true ]; then break; fi
    sleep "$POLL_INTERVAL_SECS"
  done
fi

RESOLVED=${#RESOLVED_STATUS[@]}
ACCEPTED=0
REJECTED=0
for id in "${!RESOLVED_STATUS[@]}"; do
  case "${RESOLVED_STATUS[$id]}" in
    accepted) ACCEPTED=$((ACCEPTED + 1)) ;;
    rejected) REJECTED=$((REJECTED + 1)) ;;
  esac
done
LOST=$((TRACKED - RESOLVED))
FINAL_DEPTH=$(queue_depth)

echo ""
echo "=== Results ==="
echo "  Tracked submissions:   $TRACKED"
echo "  Resolved (terminal):   $RESOLVED  (accepted=$ACCEPTED, rejected=$REJECTED)"
echo "  Lost (never resolved): $LOST"
echo "  Final queue depth:     $FINAL_DEPTH  (target 0; 'unknown' = /v1/metrics gauge unavailable)"
echo "  Pod kill attempted:    $KILL_POSSIBLE"
echo "  Replacement Ready:     $RECOVERED"

# --- Pass/fail ---------------------------------------------------------------
# Duplication guard: resolved IDs are unique (bash associative-array keys), so a
# distinct count != RESOLVED would indicate a bookkeeping bug. By construction
# RESOLVED <= TRACKED and each resolves to exactly one verdict.
PASS=true
FAIL_REASONS=()

if [ "$TRACKED" -eq 0 ]; then
  FAIL_REASONS+=("0 submissions were tracked — API accepted none; cannot assert drain")
fi
if [ "$LOST" -gt 0 ]; then
  FAIL_REASONS+=("$LOST submission(s) never reached a terminal verdict (permanent loss)")
fi
if [ "$KILL_POSSIBLE" = true ] && [ "$RECOVERED" = false ]; then
  FAIL_REASONS+=("validator pod was killed but no replacement became Ready within ${REPLACEMENT_TIMEOUT}s")
fi
# Queue-depth check is best-effort: only fail on it when we could read the gauge
# and it is non-zero after the full drain window (a real backlog).
if [ "$FINAL_DEPTH" != "unknown" ] && [ "$FINAL_DEPTH" != "0" ]; then
  FAIL_REASONS+=("queue did not drain (depth=$FINAL_DEPTH after ${DRAIN_WINDOW_SECS}s)")
fi

if [ "${#FAIL_REASONS[@]}" -gt 0 ]; then
  PASS=false
  echo ""
  for r in "${FAIL_REASONS[@]}"; do echo "  FAIL: $r"; done
fi

echo ""
if [ "$PASS" = true ]; then
  echo "=== Validator chaos test PASSED ==="
  echo "  No submissions lost; duplication prevented by BRPOP atomicity + UUID PK."
  exit 0
else
  echo "=== Validator chaos test FAILED ==="
  echo "  k6 log: $K6_LOG"
  exit 1
fi
