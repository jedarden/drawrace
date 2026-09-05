#!/bin/bash
# Table-driven tests for scripts/verify-cluster-endpoint.sh
#
# Exercises both exit paths against mock kubeconfigs so the contract
# (exit 0 on success, exit 1 on any failure, SUCCESS/ERROR messages)
# is verified rather than asserted. Run: bash tests/endpoint-validation.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/../scripts/verify-cluster-endpoint.sh"
FIXTURE_DIR="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_DIR"' EXIT

PASSED=0
FAILED=0

write_kubeconfig() {
  local file="$1" server="$2"
  cat > "$file" <<EOF
apiVersion: v1
kind: Config
current-context: mock
clusters:
- cluster:
    server: ${server}
  name: mock
contexts:
- context:
    cluster: mock
    user: mock
  name: mock
users:
- name: mock
  user:
    token: dummy
EOF
}

# check <name> <expected-rc> <expected-substring> <kubeconfig-path>
check() {
  local name="$1" expect_rc="$2" expect_msg="$3" file="$4"
  local out rc
  out=$(DRAWRACE_SKIP_DNS=1 bash "$SCRIPT" "$file" 2>&1)
  rc=$?
  if [[ "$rc" -eq "$expect_rc" && "$out" == *"$expect_msg"* ]]; then
    echo "✓ PASS: $name"
    PASSED=$((PASSED + 1))
  else
    echo "✗ FAIL: $name (rc=$rc, expected=$expect_rc)"
    echo "$out" | sed 's/^/    /'
    FAILED=$((FAILED + 1))
  fi
}

# Fixtures: valid, empty server, malformed server, http (allowed by pattern)
write_kubeconfig "$FIXTURE_DIR/valid.yaml"     "https://mock-cluster.example.invalid:6443"
write_kubeconfig "$FIXTURE_DIR/empty.yaml"     '""'
write_kubeconfig "$FIXTURE_DIR/malformed.yaml" "mock-cluster.example.invalid"

echo "=== Endpoint Validation Tests (drawrace-7c86174e) ==="
echo

check "valid endpoint → exit 0 + SUCCESS message" 0 \
  "SUCCESS: Endpoint extracted: https://mock-cluster.example.invalid:6443" \
  "$FIXTURE_DIR/valid.yaml"

check "empty endpoint → exit 1 + ERROR message" 1 \
  "ERROR: Failed to extract endpoint from kubeconfig" \
  "$FIXTURE_DIR/empty.yaml"

check "malformed endpoint → exit 1 + format ERROR" 1 \
  "ERROR: Invalid URL format" \
  "$FIXTURE_DIR/malformed.yaml"

check "missing kubeconfig → exit 1" 1 \
  "Kubeconfig not found" \
  "$FIXTURE_DIR/no-such-file.yaml"

echo
echo "=== Summary ==="
echo "Passed: $PASSED"
echo "Failed: $FAILED"

if [[ $FAILED -eq 0 ]]; then
  echo "All endpoint validation tests passed!"
  exit 0
else
  echo "Some endpoint validation tests failed!"
  exit 1
fi
