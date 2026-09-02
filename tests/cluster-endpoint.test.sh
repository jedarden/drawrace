#!/bin/bash
# Test script to verify iad-ci cluster endpoint extraction and validation

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Function to print test results
print_result() {
  local test_name="$1"
  local result="$2"
  local message="${3:-}"

  if [ "$result" = "PASS" ]; then
    echo -e "${GREEN}✓ PASS${NC}: $test_name"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL${NC}: $test_name"
    if [ -n "$message" ]; then
      echo "  $message"
    fi
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# Function to validate URL format
validate_url_format() {
  local url="$1"
  local pattern="^https?://[a-zA-Z0-9.-]+(:[0-9]+)?(/.*)?$"

  if [[ "$url" =~ $pattern ]]; then
    return 0
  else
    return 1
  fi
}

echo "=== iad-ci Cluster Endpoint Validation Tests ==="
echo

# Test 1: Kubeconfig file exists
echo "Test 1: Verify kubeconfig file exists"
KUBECONFIG_PATH="/home/coding/.kube/iad-ci.kubeconfig"
if [ -f "$KUBECONFIG_PATH" ]; then
  print_result "Kubeconfig exists" "PASS"
else
  print_result "Kubeconfig exists" "FAIL" "File not found: $KUBECONFIG_PATH"
  exit 1
fi
echo

# Test 2: Kubeconfig is readable
echo "Test 2: Verify kubeconfig is readable"
if [ -r "$KUBECONFIG_PATH" ]; then
  print_result "Kubeconfig readable" "PASS"
else
  print_result "Kubeconfig readable" "FAIL" "File not readable: $KUBECONFIG_PATH"
  exit 1
fi
echo

# Test 3: Extract server endpoint using grep
echo "Test 3: Extract server endpoint from kubeconfig"
SERVER_ENDPOINT=$(grep -A 2 "clusters:" "$KUBECONFIG_PATH" | grep "server:" | awk '{print $2}')
if [ -n "$SERVER_ENDPOINT" ]; then
  print_result "Server endpoint extraction (grep)" "PASS" "Endpoint: $SERVER_ENDPOINT"
else
  print_result "Server endpoint extraction (grep)" "FAIL" "Failed to extract endpoint"
  exit 1
fi
echo

# Test 4: Extract server endpoint using kubectl
echo "Test 4: Extract server endpoint using kubectl"
KUBECTL_ENDPOINT=$(kubectl --kubeconfig="$KUBECONFIG_PATH" config view --minify -o jsonpath='{.clusters[0].cluster.server}')
if [ -n "$KUBECTL_ENDPOINT" ]; then
  print_result "Server endpoint extraction (kubectl)" "PASS" "Endpoint: $KUBECTL_ENDPOINT"
else
  print_result "Server endpoint extraction (kubectl)" "FAIL" "kubectl failed to extract endpoint"
fi
echo

# Test 5: Verify both extraction methods match
echo "Test 5: Verify extraction methods match"
if [ "$SERVER_ENDPOINT" = "$KUBECTL_ENDPOINT" ]; then
  print_result "Extraction methods consistency" "PASS"
else
  print_result "Extraction methods consistency" "FAIL" "grep: $SERVER_ENDPOINT vs kubectl: $KUBECTL_ENDPOINT"
fi
echo

# Test 6: Validate URL format
echo "Test 6: Validate URL format"
if validate_url_format "$SERVER_ENDPOINT"; then
  print_result "URL format validation" "PASS"
else
  print_result "URL format validation" "FAIL" "Invalid URL format: $SERVER_ENDPOINT"
fi
echo

# Test 7: Verify HTTPS protocol
echo "Test 7: Verify endpoint uses HTTPS"
if [[ "$SERVER_ENDPOINT" == https://* ]]; then
  print_result "HTTPS protocol" "PASS"
else
  print_result "HTTPS protocol" "FAIL" "Endpoint does not use HTTPS: $SERVER_ENDPOINT"
fi
echo

# Test 8: Extract and validate hostname
echo "Test 8: Extract and validate hostname"
HOSTNAME=$(echo "$SERVER_ENDPOINT" | sed -E 's|https?://([^:/]+).*|\1|')
if [ -n "$HOSTNAME" ]; then
  print_result "Hostname extraction" "PASS" "Hostname: $HOSTNAME"
else
  print_result "Hostname extraction" "FAIL" "Failed to extract hostname"
fi
echo

# Test 9: Verify hostname contains expected domain
echo "Test 9: Verify hostname domain"
if [[ "$HOSTNAME" == *.spot.rackspace.com ]]; then
  print_result "Domain validation" "PASS" "Valid Rackspace Spot domain"
else
  print_result "Domain validation" "FAIL" "Unexpected domain: $HOSTNAME"
fi
echo

# Test 10: Verify kubeconfig is valid YAML
echo "Test 10: Verify kubeconfig is valid YAML"
if grep -q "apiVersion: v1" "$KUBECONFIG_PATH" && \
   grep -q "clusters:" "$KUBECONFIG_PATH" && \
   grep -q "contexts:" "$KUBECONFIG_PATH" && \
   grep -q "users:" "$KUBECONFIG_PATH"; then
  print_result "YAML structure validation" "PASS"
else
  print_result "YAML structure validation" "FAIL" "Invalid kubeconfig structure"
fi
echo

# Print summary
echo "=== Test Summary ==="
echo "Passed: $TESTS_PASSED"
echo "Failed: $TESTS_FAILED"
echo "Total: $((TESTS_PASSED + TESTS_FAILED))"
echo

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}All tests passed!${NC}"
  echo
  echo "Cluster Endpoint: $SERVER_ENDPOINT"
  echo "Hostname: $HOSTNAME"
  echo "Status: ✅ Valid"
  exit 0
else
  echo -e "${RED}Some tests failed!${NC}"
  exit 1
fi
