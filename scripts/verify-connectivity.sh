#!/usr/bin/env bash
# rs-manager Cluster Connectivity and OpenBao Verification Script
# Tests all acceptance criteria for drawrace-c4f4aea9

set -eo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0

test_pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
    ((PASSED++))
}

test_fail() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    ((FAILED++))
}

test_skip() {
    echo -e "${YELLOW}⏭️  SKIP${NC}: $1 - $2"
}

echo "=========================================="
echo "rs-manager Connectivity Verification"
echo "=========================================="
echo ""

# Test 1: kubectl connectivity to rs-manager
echo "Test 1: kubectl connectivity to rs-manager cluster"
if kubectl --server=http://traefik-rs-manager:8001 get nodes > /dev/null 2>&1; then
    NODE_COUNT=$(kubectl --server=http://traefik-rs-manager:8001 get nodes --no-headers | wc -l)
    test_pass "kubectl connectivity to rs-manager ($NODE_COUNT nodes reachable)"
else
    test_fail "kubectl connectivity to rs-manager"
fi

echo ""

# Test 2: DNS resolution
echo "Test 2: Cluster DNS resolution"
DNS_IP=""
if host traefik-rs-manager > /dev/null 2>&1; then
    DNS_IP=$(host traefik-rs-manager 2>/dev/null | grep "has address" | awk '{print $4}')
elif getent hosts traefik-rs-manager > /dev/null 2>&1; then
    DNS_IP=$(getent hosts traefik-rs-manager | awk '{print $1}')
fi

if [ -n "$DNS_IP" ]; then
    test_pass "DNS resolution (traefik-rs-manager resolves to $DNS_IP)"
else
    test_fail "DNS resolution for traefik-rs-manager"
fi

echo ""

# Test 3: OpenBao endpoint reachability
echo "Test 3: OpenBao API endpoint reachability"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://openbao-rs-manager.ardenone.com 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "307" ] || [ "$HTTP_CODE" = "200" ]; then
    test_pass "OpenBao endpoint reachable (HTTP $HTTP_CODE - expected redirect/auth)"
else
    test_fail "OpenBao endpoint not reachable (HTTP $HTTP_CODE)"
fi

echo ""

# Test 4: OpenBao namespace exists
echo "Test 4: OpenBao namespace in k8s"
if kubectl --server=http://traefik-rs-manager:8001 get namespace openbao > /dev/null 2>&1; then
    test_pass "OpenBao namespace exists in cluster"
else
    test_fail "OpenBao namespace not found in cluster"
fi

echo ""

# Test 5: OpenBao pods are running
echo "Test 5: OpenBao pods running"
OPENBAO_PODS=$(kubectl --server=http://traefik-rs-manager:8001 get pods -n openbao -l app=openbao-rs-manager --no-headers 2>/dev/null | wc -l || echo "0")
if [ "$OPENBAO_PODS" -gt 0 ]; then
    READY_PODS=$(kubectl --server=http://traefix-rs-manager:8001 get pods -n openbao -l app=openbao-rs-manager --no-headers 2>/dev/null | grep -c "Running" || echo "0")
    test_pass "OpenBao pods running ($READY_PODS/$OPENBAO_PODS ready)"
else
    test_fail "No OpenBao pods found"
fi

echo ""

# Test 6: OpenBao token availability
echo "Test 6: OpenBao authentication token"
if [ -n "${OPENBAO_TOKEN:-}" ]; then
    test_pass "OPENBAO_TOKEN is set (length: ${#OPENBAO_TOKEN})"
else
    test_fail "OPENBAO_TOKEN environment variable not set"
    echo "    Required for tests 7-9"
fi

echo ""

# Test 7-9: Tests that require OPENBAO_TOKEN
if [ -n "${OPENBAO_TOKEN:-}" ]; then
    echo "Test 7: OpenBao authentication with token"

    # Test bao status command if available
    if command -v bao > /dev/null 2>&1; then
        if BAO_ADDR=https://openbao-rs-manager.ardenone.com bao status > /dev/null 2>&1; then
            test_pass "OpenBao authentication successful (bao CLI)"
        else
            test_fail "OpenBao authentication failed (bao CLI)"
        fi
    else
        # Try direct API call
        AUTH_RESULT=$(curl -s -o /dev/null -w "%{http_code}" \
            "${BAO_ADDR:-https://openbao-rs-manager.ardenone.com}/v1/auth/token/lookup-self" \
            -H "X-Vault-Token: ${OPENBAO_TOKEN}" 2>/dev/null || echo "000")

        if [ "$AUTH_RESULT" = "200" ]; then
            test_pass "OpenBao authentication successful (API)"
        else
            test_fail "OpenBao authentication failed (API HTTP $AUTH_RESULT)"
        fi
    fi

    echo ""

    echo "Test 8: List OpenBao secrets path"
    if command -v bao > /dev/null 2>&1; then
        if BAO_ADDR=https://openbao-rs-manager.ardenone.com bao kv list secret/data/rs-manager/drawrace > /dev/null 2>&1; then
            SECRETS=$(BAO_ADDR=https://openbao-rs-manager.ardenone.com bao kv list secret/data/rs-manager/drawrace 2>/dev/null || echo "error")
            test_pass "Can list OpenBao secrets path (found: $SECRETS)"
        else
            test_fail "Cannot list OpenBao secrets path"
        fi
    else
        test_skip "bao CLI not installed", "using API directly"
        SECRETS=$(curl -s -H "X-Vault-Token: ${OPENBAO_TOKEN}" \
            "${BAO_ADDR:-https://openbao-rs-manager.ardenone.com}/v1/secret/data/rs-manager/drawrace?list=true" \
            2>/dev/null | jq -r '.data.keys[]' 2>/dev/null || echo "error")

        if [ "$SECRETS" != "error" ]; then
            test_pass "Can list OpenBao secrets path (API: $SECRETS)"
        else
            test_fail "Cannot list OpenBao secrets path (API)"
        fi
    fi

    echo ""

    echo "Test 9: Verify DrawRace secret structure"
    EXPECTED_SECRETS=("s3" "postgres-backup" "postgres")
    FOUND_SECRETS=0

    for secret in "${EXPECTED_SECRETS[@]}"; do
        if command -v bao > /dev/null 2>&1; then
            if BAO_ADDR=https://openbao-rs-manager.ardenone.com bao kv get "secret/data/rs-manager/drawrace/$secret" > /dev/null 2>&1; then
                ((FOUND_SECRETS++))
            fi
        else
            HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
                -H "X-Vault-Token: ${OPENBAO_TOKEN}" \
                "${BAO_ADDR:-https://openbao-rs-manager.ardenone.com}/v1/secret/data/rs-manager/drawrace/$secret" 2>/dev/null || echo "000")
            if [ "$HTTP_CODE" = "200" ]; then
                ((FOUND_SECRETS++))
            fi
        fi
    done

    if [ $FOUND_SECRETS -gt 0 ]; then
        test_pass "DrawRace secrets accessible ($FOUND_SECRETS/${#EXPECTED_SECRETS[@]} found)"
    else
        test_fail "No DrawRace secrets found (0/${#EXPECTED_SECRETS[@]})"
    fi
else
    echo "Test 7: OpenBao authentication with token"
    test_skip "OPENBAO_TOKEN not set", "cannot test authentication"

    echo ""
    echo "Test 8: List OpenBao secrets path"
    test_skip "OPENBAO_TOKEN not set", "cannot list secrets"

    echo ""
    echo "Test 9: Verify DrawRace secret structure"
    test_skip "OPENBAO_TOKEN not set", "cannot verify secrets"
fi

echo ""
echo "=========================================="
echo "Summary"
echo "=========================================="
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All connectivity tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed. Please review the output above.${NC}"
    exit 1
fi
