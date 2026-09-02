#!/bin/bash
# Verify cluster endpoint connection timeout
# Tests that the connection completes within 10 seconds and doesn't hang indefinitely

# Extract endpoint and parse hostname:port
ENDPOINT=$(kubectl --kubeconfig=/home/coding/.kube/iad-ci.kubeconfig config view --minify -o jsonpath='{.clusters[0].cluster.server}')

# Remove protocol and extract hostname
CLEANED="${ENDPOINT#https://}"
HOST=$(echo "$CLEANED" | cut -d/ -f1 | cut -d: -f1)

# Check if there's a port specified, default to 443 for https
if echo "$CLEANED" | grep -q ':'; then
  PORT=$(echo "$CLEANED" | cut -d: -f2 | cut -d/ -f1)
else
  PORT=443
fi

echo "Testing connection timeout to $HOST:$PORT"

# Test with explicit timeout and timing
start=$(date +%s)
timeout 10 bash -c "cat < /dev/null > /dev/tcp/$HOST/$PORT" 2>&1
exit_code=$?
end=$(date +%s)
elapsed=$((end - start))

if [ $exit_code -eq 0 ]; then
  echo "SUCCESS: Connected in $elapsed seconds"
  exit 0
elif [ $elapsed -ge 10 ]; then
  echo "FAILED: Timeout exceeded 10 seconds"
  exit 1
else
  echo "Connection failed in $elapsed seconds (exit code: $exit_code)"
  exit 1
fi
