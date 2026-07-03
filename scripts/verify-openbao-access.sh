#!/usr/bin/env bash
# Verification script for OpenBao root token access
# Run this after receiving the OpenBao root token to verify it works

set -euo pipefail

# Check if OPENBAO_TOKEN is set
if [ -z "${OPENBAO_TOKEN:-}" ]; then
    echo "❌ OPENBAO_TOKEN environment variable is not set"
    echo "   Please export the token first:"
    echo "   export OPENBAO_TOKEN=<your-root-token>"
    exit 1
fi

# Check if OPENBAO_ADDR is set
if [ -z "${OPENBAO_ADDR:-}" ]; then
    echo "❌ OPENBAO_ADDR environment variable is not set"
    echo "   Please set the OpenBao endpoint:"
    echo "   export OPENBAO_ADDR=http://openbao.<namespace>.svc.cluster.local:8200"
    exit 1
fi

echo "🔍 Testing OpenBao access..."
echo "   Endpoint: $OPENBAO_ADDR"
echo ""

# Test 1: Read OpenBao status
echo "Test 1: Checking OpenBao status..."
if STATUS=$(curl -s --header "X-Vault-Token: $OPENBAO_TOKEN" \
    "$OPENBAO_ADDR/v1/sys/health"); then
    echo "✅ Successfully connected to OpenBao"
    echo "   Response: $(echo "$STATUS" | jq -r '.initialized // "unknown"')"
else
    echo "❌ Failed to connect to OpenBao"
    exit 1
fi

# Test 2: Test token lookup
echo ""
echo "Test 2: Verifying token permissions..."
if TOKEN_INFO=$(curl -s --header "X-Vault-Token: $OPENBAO_TOKEN" \
    "$OPENBAO_ADDR/v1/auth/token/lookup-self"); then
    if echo "$TOKEN_INFO" | jq -e '.data.policies' >/dev/null 2>&1; then
        POLICIES=$(echo "$TOKEN_INFO" | jq -r '.data.policies[]')
        echo "✅ Token is valid with policies:"
        echo "   $POLICIES"
    else
        echo "⚠️  Token lookup returned unexpected response"
    fi
else
    echo "❌ Failed to lookup token"
    exit 1
fi

# Test 3: Test write capability (try to write to a test path)
echo ""
echo "Test 3: Testing secret write capability..."
TEST_PATH="drawrace/test/verification-$(date +%s)"
TEST_DATA='{"test":"verification","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'

if WRITE_RESULT=$(curl -s --request POST \
    --header "X-Vault-Token: $OPENBAO_TOKEN" \
    --data "$TEST_DATA" \
    "$OPENBAO_ADDR/v1/kv/$TEST_PATH"); then
    echo "✅ Successfully wrote test secret to kv/$TEST_PATH"

    # Try to read it back
    if READ_RESULT=$(curl -s --header "X-Vault-Token: $OPENBAO_TOKEN" \
        "$OPENBAO_ADDR/v1/kv/$TEST_PATH"); then
        echo "✅ Successfully read back test secret"
        # Clean up
        curl -s --request DELETE --header "X-Vault-Token: $OPENBAO_TOKEN" \
            "$OPENBAO_ADDR/v1/kv/$TEST_PATH" >/dev/null 2>&1 || true
        echo "✅ Verification complete - OpenBao access is working!"
    else
        echo "❌ Failed to read back test secret"
        exit 1
    fi
else
    echo "❌ Failed to write test secret"
    echo "   Response: $WRITE_RESULT"
    exit 1
fi

echo ""
echo "🎉 All OpenBao tests passed!"
echo ""
echo "Next steps:"
echo "1. Store the token securely: export OPENBAO_TOKEN=<token>"
echo "2. Add to your shell profile (.bashrc/.zshrc) for persistence"
