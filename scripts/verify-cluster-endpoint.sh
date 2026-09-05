#!/bin/bash
# Extract and validate cluster endpoint from iad-ci kubeconfig
#
# Extraction uses the canonical kubectl jsonpath (drawrace-08c4f183 /
# drawrace-7c86174e). The endpoint must be non-empty and a well-formed
# http(s) URL; any failure exits 1, success prints the URL and exits 0.
#
# Usage: verify-cluster-endpoint.sh [kubeconfig-path]
#   DRAWRACE_SKIP_DNS=1  skip the informational DNS-resolution check

set -euo pipefail

KUBECONFIG_PATH="${1:-/home/coding/.kube/iad-ci.kubeconfig}"

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

# Extract server endpoint from kubeconfig via kubectl
if ! ENDPOINT=$(kubectl --kubeconfig="$KUBECONFIG_PATH" config view --minify -o jsonpath="{.clusters[0].cluster.server}"); then
  echo "ERROR: kubectl failed to read kubeconfig: $KUBECONFIG_PATH"
  exit 1
fi

# Empty endpoint is a hard failure
if [[ -z "$ENDPOINT" ]]; then
  echo "ERROR: Failed to extract endpoint from kubeconfig"
  exit 1
fi

echo "📍 Extracted server endpoint: $ENDPOINT"
echo

# Validate URL format
URL_PATTERN="^https?://[a-zA-Z0-9.-]+(:[0-9]+)?(/.*)?$"

if [[ ! "$ENDPOINT" =~ $URL_PATTERN ]]; then
  echo "ERROR: Invalid URL format: $ENDPOINT"
  echo "Expected format: https://hostname[:port][/path]"
  exit 1
fi

echo "✅ Server endpoint URL format is valid"
echo

# Validate hostname exists
HOSTNAME=$(echo "$ENDPOINT" | sed -E 's|https?://([^:/]+).*|\1|')
echo "🔍 Extracted hostname: $HOSTNAME"

if [[ -z "$HOSTNAME" ]]; then
  echo "ERROR: Failed to extract hostname from endpoint"
  exit 1
fi

echo "✅ Hostname extracted successfully"
echo

# Test basic connectivity (DNS resolution) — informational only, never fatal
if [[ "${DRAWRACE_SKIP_DNS:-0}" == "1" ]]; then
  echo "⏭️  DNS check skipped (DRAWRACE_SKIP_DNS=1)"
else
  echo "🌐 Testing DNS resolution for $HOSTNAME..."
  if nslookup "$HOSTNAME" >/dev/null 2>&1; then
    echo "✅ DNS resolution successful"
  else
    echo "⚠️  DNS resolution failed (network may be unavailable)"
  fi
fi
echo

# Summary
echo "=== Summary ==="
echo "Kubeconfig: $KUBECONFIG_PATH"
echo "Server Endpoint: $ENDPOINT"
echo "Hostname: $HOSTNAME"
echo "SUCCESS: Endpoint extracted: $ENDPOINT"
echo "Status: ✅ Valid"
echo
