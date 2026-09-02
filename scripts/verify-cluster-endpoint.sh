#!/bin/bash
# Extract and validate cluster endpoint from iad-ci kubeconfig

set -euo pipefail

KUBECONFIG_PATH="/home/coding/.kube/iad-ci.kubeconfig"

echo "=== Cluster Endpoint Verification ==="
echo

# Check if kubeconfig exists
if [ ! -f "$KUBECONFIG_PATH" ]; then
  echo "❌ Kubeconfig not found: $KUBECONFIG_PATH"
  exit 1
fi

echo "✅ Kubeconfig exists: $KUBECONFIG_PATH"
echo

# Check if kubeconfig is readable
if [ ! -r "$KUBECONFIG_PATH" ]; then
  echo "❌ Kubeconfig not readable: $KUBECONFIG_PATH"
  exit 1
fi

echo "✅ Kubeconfig is readable"
echo

# Extract server endpoint from kubeconfig
SERVER_ENDPOINT=$(grep -A 2 "clusters:" "$KUBECONFIG_PATH" | grep "server:" | awk '{print $2}')

if [ -z "$SERVER_ENDPOINT" ]; then
  echo "❌ Failed to extract server endpoint from kubeconfig"
  exit 1
fi

echo "📍 Extracted server endpoint: $SERVER_ENDPOINT"
echo

# Validate URL format
URL_PATTERN="^https?://[a-zA-Z0-9.-]+(:[0-9]+)?(/.*)?$"

if [[ ! "$SERVER_ENDPOINT" =~ $URL_PATTERN ]]; then
  echo "❌ Invalid URL format"
  echo "Expected format: https://hostname[:port][/path]"
  exit 1
fi

echo "✅ Server endpoint URL format is valid"
echo

# Validate hostname exists
HOSTNAME=$(echo "$SERVER_ENDPOINT" | sed -E 's|https?://([^:/]+).*|\1|')
echo "🔍 Extracted hostname: $HOSTNAME"

if [ -z "$HOSTNAME" ]; then
  echo "❌ Failed to extract hostname from endpoint"
  exit 1
fi

echo "✅ Hostname extracted successfully"
echo

# Test basic connectivity (DNS resolution)
echo "🌐 Testing DNS resolution for $HOSTNAME..."
if nslookup "$HOSTNAME" >/dev/null 2>&1; then
  echo "✅ DNS resolution successful"
else
  echo "⚠️  DNS resolution failed (network may be unavailable)"
fi
echo

# Summary
echo "=== Summary ==="
echo "Kubeconfig: $KUBECONFIG_PATH"
echo "Server Endpoint: $SERVER_ENDPOINT"
echo "Hostname: $HOSTNAME"
echo "Status: ✅ Valid"
echo
