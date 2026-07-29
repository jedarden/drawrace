#!/usr/bin/env bash
# Production deployment monitoring script for bead bf-9ypvb
#
# This script checks if the drawrace production deployment has landed.
# Run this periodically (e.g., daily) to detect when deployment happens.
#
# Acceptance criteria (all must pass):
#   1. drawrace namespace contains Deployments
#   2. CloudNativePG Postgres cluster exists
#   3. At least one Secret exists (DATABASE_URL + S3 creds)
#   4. api-drawrace.ardenone.com resolves
#
# Usage: ./scripts/check-deployment-landed.sh
# Exit code: 0 if deployment landed, 1 if still blocked

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

checks_passed=0
checks_total=4

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "DrawRace Production Deployment Monitor"
echo "Bead: bf-9ypvb"
echo "Checked: $(date -u +%Y-%m-%d\ %H:%M:%S\ UTC)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

# Check 1: Deployments exist
echo -n "[1/4] Checking for Deployments in drawrace namespace... "
DEPLOYMENTS=$(kubectl --server=http://traefik-rs-manager:8001 get deployments -n drawrace 2>&1)
if echo "$DEPLOYMENTS" | grep -q "drawrace" && ! echo "$DEPLOYMENTS" | grep -q "No resources found"; then
  echo -e "${GREEN}✓ PASS${NC}"
  echo "$DEPLOYMENTS"
  ((checks_passed++))
else
  echo -e "${RED}✗ FAIL${NC}"
  echo "       No Deployments found"
fi
echo

# Check 2: CloudNativePG Postgres cluster
echo -n "[2/4] Checking for CloudNativePG Postgres cluster... "
POSTGRES=$(kubectl --server=http://traefik-rs-manager:8001 get cluster.postgresql.cnpg.io -n drawrace 2>&1)
if echo "$POSTGRES" | grep -q "drawrace" && ! echo "$POSTGRES" | grep -q "No resources found"; then
  echo -e "${GREEN}✓ PASS${NC}"
  echo "$POSTGRES"
  ((checks_passed++))
else
  echo -e "${RED}✗ FAIL${NC}"
  echo "       No CloudNativePG cluster found"
fi
echo

# Check 3: Secrets exist
echo -n "[3/4] Checking for Secrets in drawrace namespace... "
SECRETS=$(kubectl --server=http://traefik-rs-manager:8001 get secrets -n drawrace 2>&1)
# Count non-default secrets (exclude kube-root-ca.crt)
SECRET_COUNT=$(echo "$SECRETS" | grep -v "NAME.*kube-root-ca.crt" | grep -c "^drawrace" || true)
if [ "$SECRET_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✓ PASS${NC}"
  echo "$SECRETS"
  ((checks_passed++))
else
  echo -e "${RED}✗ FAIL${NC}"
  echo "       No Secrets found (except kube-root-ca.crt)"
fi
echo

# Check 4: API DNS resolves
echo -n "[4/4] Checking if api-drawrace.ardenone.com resolves... "
if getent hosts api-drawrace.ardenone.com >/dev/null 2>&1; then
  echo -e "${GREEN}✓ PASS${NC}"
  getent hosts api-drawrace.ardenone.com
  ((checks_passed++))
else
  echo -e "${RED}✗ FAIL${NC}"
  echo "       NXDOMAIN - API does not resolve"
fi
echo

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "Summary: ${checks_passed}/${checks_total} checks passed"

if [ "$checks_passed" -eq "$checks_total" ]; then
  echo -e "${GREEN}✓ DEPLOYMENT LANDED - All acceptance criteria met${NC}"
  echo "Next step: Update scripts/extract-reference-ghosts.sh header"
  echo "         Close bead bf-9ypvb"
  exit 0
else
  echo -e "${RED}✗ STILL BLOCKED - Deployment has not landed yet${NC}"
  echo "Blocker details: See BLOCKER_SUMMARY.md"
  echo ""
  echo "When deployment lands:"
  echo "  1. Update scripts/extract-reference-ghosts.sh header with new state"
  echo "  2. Verify DATABASE_URL and S3 creds are accessible"
  echo "  3. Run: br close bf-9ypvb --body 'Production deployment verified'"
  exit 1
fi
