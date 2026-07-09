#!/usr/bin/env bash
# Verify OpenBao token access
# Usage: OPENBAO_TOKEN=<token> ./scripts/verify-openbao.sh

set -euo pipefail

OPENBAO_ADDR="${OPENBAO_ADDR:-https://openbao.ardenone.com}"

if [ -z "${OPENBAO_TOKEN:-}" ]; then
  echo "❌ OPENBAO_TOKEN environment variable not set"
  echo "   Usage: OPENBAO_TOKEN=<token> $0"
  exit 1
fi

echo "Testing OpenBao access at ${OPENBAO_ADDR}..."

# Test basic token status
echo "1. Checking token status..."
STATUS=$(curl -s --request GET \
  "${OPENBAO_ADDR}/v1/auth/token/lookup-self" \
  -H "X-Vault-Token: ${OPENBAO_TOKEN}")

if echo "${STATUS}" | jq -e '.errors' >/dev/null; then
  echo "❌ Token is invalid or expired:"
  echo "${STATUS}" | jq -r '.errors[0]'
  exit 1
fi

DISPLAY_NAME=$(echo "${STATUS}" | jq -r '.data.display_name')
POLICIES=$(echo "${STATUS}" | jq -r '.data.policies[]' | tr '\n' ' ')
TTL=$(echo "${STATUS}" | jq -r '.data.ttl')

echo "✅ Token is valid"
echo "   Display name: ${DISPLAY_NAME}"
echo "   Policies: ${POLICIES}"
echo "   TTL: ${TTL}"

# Test list secrets (basic read access)
echo ""
echo "2. Testing list access to /drawrace..."
SECRETS=$(curl -s --request LIST \
  "${OPENBAO_ADDR}/v1/secret/drawrace" \
  -H "X-Vault-Token: ${OPENBAO_TOKEN}")

if echo "${SECRETS}" | jq -e '.errors' >/dev/null; then
  echo "❌ Cannot list secrets in /drawrace:"
  echo "${SECRETS}" | jq -r '.errors[0]'
  exit 1
fi

SECRET_KEYS=$(echo "${SECRETS}" | jq -r '.data.keys[]' | wc -l)
echo "✅ Can list secrets (${SECRET_KEYS} keys in /drawrace)"

# Test write access
echo ""
echo "3. Testing write access to /drawrace/..."
TEST_PAYLOAD='{"test": "verification", "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}"}'
WRITE_RESULT=$(curl -s --request POST \
  "${OPENBAO_ADDR}/v1/secret/data/drawrace/test-verify" \
  -H "X-Vault-Token: ${OPENBAO_TOKEN}" \
  -d "${TEST_PAYLOAD}")

if echo "${WRITE_RESULT}" | jq -e '.errors' >/dev/null; then
  echo "❌ Cannot write secrets in /drawrace:"
  echo "${WRITE_RESULT}" | jq -r '.errors[0]'
  exit 1
fi

echo "✅ Can write secrets to /drawrace"

# Cleanup test secret
echo ""
echo "4. Cleaning up test secret..."
curl -s --request DELETE \
  "${OPENBAO_ADDR}/v1/secret/metadata/drawrace/test-verify" \
  -H "X-Vault-Token: ${OPENBAO_TOKEN}" >/dev/null

echo ""
echo "🎉 All OpenBao verification checks passed!"
echo ""
echo "Token ${OPENBAO_TOKEN:0:16}... has:"
echo "  ✓ Valid authentication"
echo "  ✓ List access to /drawrace"
echo "  ✓ Write access to /drawrace"
