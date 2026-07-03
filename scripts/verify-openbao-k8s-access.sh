#!/usr/bin/env bash
# Verification script for OpenBao and K8s access
# Run this after infrastructure team grants permissions to verify access works

set -euo pipefail

echo "====================================="
echo "OpenBao & K8s Access Verification"
echo "====================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass_count=0
fail_count=0

check_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((pass_count++))
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    ((fail_count++))
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Test 1: OPENBAO_TOKEN environment variable
echo "1. Checking OPENBAO_TOKEN environment variable..."
if [ -z "${OPENBAO_TOKEN:-}" ]; then
    check_fail "OPENBAO_TOKEN not set"
    echo "   Run: export OPENBAO_TOKEN=<your-token>"
else
    check_pass "OPENBAO_TOKEN is set"
    echo "   Token length: ${#OPENBAO_TOKEN} characters"
fi
echo ""

# Test 2: OpenBao endpoint configuration
echo "2. Checking OpenBao endpoint configuration..."
OPENBAO_HOST="${OPENBAO_HOST:-}"
if [ -z "$OPENBAO_HOST" ]; then
    check_warn "OPENBAO_HOST not set (using default from infra team)"
    OPENBAO_HOST="openbao.example.com"  # Replace with actual endpoint
else
    check_pass "OPENBAO_HOST configured: $OPENBAO_HOST"
fi
echo ""

# Test 3: OpenBao API health check
echo "3. Testing OpenBao API access..."
if [ -n "${OPENBAO_TOKEN:-}" ] && [ -n "$OPENBAO_HOST" ]; then
    if curl -s -f -H "X-Vault-Token: $OPENBAO_TOKEN" \
        "https://$OPENBAO_HOST/v1/sys/health" > /dev/null 2>&1; then
        check_pass "Can reach OpenBao API"
    else
        check_fail "Cannot reach OpenBao API"
        echo "   Check: OPENBAO_TOKEN and OPENBAO_HOST are correct"
    fi
else
    check_fail "Skipping - OPENBAO_TOKEN or OPENBAO_HOST not set"
fi
echo ""

# Test 4: OpenBao write permissions
echo "4. Testing OpenBao write permissions..."
if [ -n "${OPENBAO_TOKEN:-}" ] && [ -n "$OPENBAO_HOST" ]; then
    # Try to write a test secret
    TEST_SECRET_PATH="drawrace/test/verification-$(date +%s)"
    if curl -X POST -s -f \
        -H "X-Vault-Token: $OPENBAO_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"data":{"test":"value","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}}' \
        "https://$OPENBAO_HOST/v1/secret/data/$TEST_SECRET_PATH" > /dev/null 2>&1; then
        check_pass "Can write secrets to OpenBao"

        # Clean up test secret
        curl -X DELETE -s -H "X-Vault-Token: $OPENBAO_TOKEN" \
            "https://$OPENBAO_HOST/v1/secret/data/$TEST_SECRET_PATH" > /dev/null 2>&1 || true
    else
        check_fail "Cannot write secrets to OpenBao"
        echo "   Verify token has 'create' and 'update' capabilities on drawrace/*"
    fi
else
    check_fail "Skipping - OPENBAO_TOKEN or OPENBAO_HOST not set"
fi
echo ""

# Test 5: K8s cluster access
echo "5. Checking kubectl access to iad-acb..."
K8S_SERVER="${K8S_SERVER:-http://traefik-iad-acb:8001}"
if kubectl --server="$K8S_SERVER" cluster-info > /dev/null 2>&1; then
    check_pass "Can reach iad-acb cluster"
else
    check_fail "Cannot reach iad-acb cluster"
    echo "   Check: kubectl is configured and Tailscale connection is active"
fi
echo ""

# Test 6: Namespace creation permissions
echo "6. Testing namespace creation permissions..."
if kubectl --server="$K8S_SERVER" auth can-i create namespace > /dev/null 2>&1; then
    check_pass "Can create namespaces"
else
    check_fail "Cannot create namespaces"
    echo "   Required for: Creating 'drawrace' namespace"
fi
echo ""

# Test 7: GarageBucket creation permissions
echo "7. Testing GarageBucket resource creation..."
if kubectl --server="$K8S_SERVER" auth can-i create garagebuckets.garage.rajsingh.info --all-namespaces > /dev/null 2>&1; then
    check_pass "Can create GarageBucket resources"

    # Test creating a test GarageBucket (dry-run)
    if kubectl --server="$K8S_SERVER" create garagebucket test-verification \
        --dry-run=client -n drawrace > /dev/null 2>&1; then
        check_pass "GarageBucket CRD is functional"
    else
        check_fail "GarageBucket CRD exists but validation failed"
    fi
else
    check_fail "Cannot create GarageBucket resources"
    echo "   Required for: Creating S3 bucket for ghost blob storage"
fi
echo ""

# Test 8: GarageKey creation permissions
echo "8. Testing GarageKey resource creation..."
if kubectl --server="$K8S_SERVER" auth can-i create garagekeys.garage.rajsingh.info --all-namespaces > /dev/null 2>&1; then
    check_pass "Can create GarageKey resources"
else
    check_fail "Cannot create GarageKey resources"
    echo "   Required for: Creating S3 credentials"
fi
echo ""

# Test 9: CloudNativePG permissions
echo "9. Testing CloudNativePG cluster creation..."
if kubectl --server="$K8S_SERVER" auth can-i create clusters.postgresql.cnpg.io --all-namespaces > /dev/null 2>&1; then
    check_pass "Can create CloudNativePG clusters"
else
    check_fail "Cannot create CloudNativePG clusters"
    echo "   Required for: Creating Postgres database"
fi
echo ""

# Test 10: ArgoCD Application permissions
echo "10. Testing ArgoCD Application creation..."
if kubectl --server="$K8S_SERVER" auth can-i create applications.argoproj.io -n argocd > /dev/null 2>&1; then
    check_pass "Can create ArgoCD Applications"
else
    check_warn "Cannot create ArgoCD Applications (may be created by infra team)"
    echo "   Note: This may be created by infrastructure team during setup"
fi
echo ""

# Summary
echo "====================================="
echo "Summary"
echo "====================================="
echo -e "${GREEN}Passed:${NC} $pass_count"
echo -e "${RED}Failed:${NC} $fail_count"
echo ""

if [ $fail_count -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo "You have all required permissions to proceed with DrawRace deployment."
    exit 0
else
    echo -e "${RED}✗ $fail_count check(s) failed${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Contact infrastructure team for missing permissions"
    echo "2. Refer to OPENBAO_K8S_ACCESS_CHECKLIST.md for detailed requirements"
    echo "3. Re-run this script after permissions are granted"
    exit 1
fi
