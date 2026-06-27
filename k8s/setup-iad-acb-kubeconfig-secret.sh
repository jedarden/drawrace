#!/usr/bin/env bash
# Setup script for drawrace-build rotate-client-key cross-cluster access
#
# This script automates the creation of a kubeconfig secret in iad-ci's
# argo-workflows namespace that allows the drawrace-build workflow to
# update ConfigMaps on iad-acb.
#
# Usage: ./setup-iad-acb-kubeconfig-secret.sh <iad-acb-kubeconfig-path> [iad-ci-kubeconfig-path]
#
# Arguments:
#   iad-acb-kubeconfig-path: Path to the iad-acb kubeconfig file (required)
#   iad-ci-kubeconfig-path:  Path to the iad-ci kubeconfig file (optional, defaults to in-cluster)
#
# Example:
#   ./setup-iad-acb-kubeconfig-secret.sh ~/.kube/iad-acb.config ~/.kube/iad-ci.config

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Check arguments
if [ $# -lt 1 ]; then
  log_error "Usage: $0 <iad-acb-kubeconfig-path> [iad-ci-kubeconfig-path]"
  exit 1
fi

IAD_ACB_KUBECONFIG="$1"
IAD_CI_KUBECONFIG="${2:-}"

# Validate iad-acb kubeconfig exists
if [ ! -f "$IAD_ACB_KUBECONFIG" ]; then
  log_error "iad-acb kubeconfig not found: $IAD_ACB_KUBECONFIG"
  exit 1
fi

KUBECTL_IAD_ACB="kubectl --kubeconfig=$IAD_ACB_KUBECONFIG"

log_info "Using iad-acb kubeconfig: $IAD_ACB_KUBECONFIG"

# Determine kubectl command for iad-ci (use in-cluster if not specified)
if [ -z "$IAD_CI_KUBECONFIG" ]; then
  log_warn "No iad-ci kubeconfig provided, will use in-cluster config (assumes running on iad-ci)"
  KUBECTL_IAD_CI="kubectl"
  USE_IN_CLUSTER=true
else
  if [ ! -f "$IAD_CI_KUBECONFIG" ]; then
    log_error "iad-ci kubeconfig not found: $IAD_CI_KUBECONFIG"
    exit 1
  fi
  KUBECTL_IAD_CI="kubectl --kubeconfig=$IAD_CI_KUBECONFIG"
  log_info "Using iad-ci kubeconfig: $IAD_CI_KUBECONFIG"
  USE_IN_CLUSTER=false
fi

# Step 1: Apply RBAC manifests to iad-acb
log_info "Step 1: Applying RBAC manifests to iad-acb..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RBAC_MANIFEST="$SCRIPT_DIR/iad-acb-drawrace-rotate-key-rbac.yaml"

if [ ! -f "$RBAC_MANIFEST" ]; then
  log_error "RBAC manifest not found: $RBAC_MANIFEST"
  exit 1
fi

$KUBECTL_IAD_ACB apply -f "$RBAC_MANIFEST" || {
  log_error "Failed to apply RBAC manifests to iad-acb"
  exit 1
}
log_info "RBAC manifests applied successfully"

# Step 2: Get the iad-acb cluster endpoint
log_info "Step 2: Getting iad-acb cluster endpoint..."
CLUSTER_ENDPOINT=$($KUBECTL_IAD_ACB config view -o jsonpath='{.clusters[0].cluster.server}')

if [ -z "$CLUSTER_ENDPOINT" ]; then
  log_error "Failed to get cluster endpoint from iad-acb kubeconfig"
  exit 1
fi

log_info "Cluster endpoint: $CLUSTER_ENDPOINT"

# Step 3: Get the ServiceAccount token
log_info "Step 3: Getting ServiceAccount token from iad-acb..."

# First, check if the ServiceAccount exists
if ! $KUBECTL_IAD_ACB -n drawrace get serviceaccount drawrace-rotate-key &>/dev/null; then
  log_error "ServiceAccount 'drawrace-rotate-key' not found in drawrace namespace on iad-acb"
  log_error "Make sure RBAC manifests were applied correctly"
  exit 1
fi

# Get the secret name
SA_SECRET_NAME=$($KUBECTL_IAD_ACB -n drawrace get serviceaccount drawrace-rotate-key -o jsonpath='{.secrets[0].name}')

if [ -z "$SA_SECRET_NAME" ]; then
  log_error "No secret found for ServiceAccount 'drawrace-rotate-key'"
  exit 1
fi

# Get the token
SA_TOKEN=$($KUBECTL_IAD_ACB -n drawrace get secret "$SA_SECRET_NAME" -o jsonpath='{.data.token}' | base64 -d)

if [ -z "$SA_TOKEN" ]; then
  log_error "Failed to extract token from secret '$SA_SECRET_NAME'"
  exit 1
fi

log_info "Token extracted successfully"

# Step 4: Get the iad-acb CA certificate
log_info "Step 4: Getting iad-acb CA certificate..."
CA_DATA=$($KUBECTL_IAD_ACB config view -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')

if [ -z "$CA_DATA" ]; then
  log_error "Failed to get CA certificate from iad-acb kubeconfig"
  exit 1
fi

# Create a temporary directory for the kubeconfig
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

KUBECONFIG_FILE="$TEMP_DIR/drawrace-iad-acb-kubeconfig.yaml"

# Step 5: Create the kubeconfig file
log_info "Step 5: Creating kubeconfig file..."

cat > "$KUBECONFIG_FILE" <<EOF
apiVersion: v1
kind: Config
clusters:
  - cluster:
      certificate-authority-data: ${CA_DATA}
      server: ${CLUSTER_ENDPOINT}
    name: iad-acb
users:
  - user:
      token: ${SA_TOKEN}
    name: drawrace-rotate-key
contexts:
  - context:
      cluster: iad-acb
      user: drawrace-rotate-key
    name: drawrace-rotate-key@iad-acb
current-context: drawrace-rotate-key@iad-acb
EOF

log_info "Kubeconfig file created: $KUBECONFIG_FILE"

# Step 6: Create the secret in iad-ci argo-workflows namespace
log_info "Step 6: Creating secret in iad-ci argo-workflows namespace..."

# Check if the secret already exists
if $KUBECTL_IAD_CI -n argo-workflows get secret drawrace-iad-acb-kubeconfig &>/dev/null; then
  log_warn "Secret 'drawrace-iad-acb-kubeconfig' already exists in argo-workflows namespace"
  read -p "Do you want to replace it? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_info "Skipping secret creation"
    exit 0
  fi
  log_info "Deleting existing secret..."
  $KUBECTL_IAD_CI -n argo-workflows delete secret drawrace-iad-acb-kubeconfig
fi

$KUBECTL_IAD_CI -n argo-workflows create secret generic drawrace-iad-acb-kubeconfig \
  --from-file=config.yaml="$KUBECONFIG_FILE" || {
  log_error "Failed to create secret in iad-ci"
  exit 1
}

log_info "Secret created successfully"

# Step 7: Verify the setup
log_info "Step 7: Verifying the setup..."

# Extract the kubeconfig from the secret for testing
VERIFY_KUBECONFIG="$TEMP_DIR/verify-kubeconfig.yaml"
$KUBECTL_IAD_CI -n argo-workflows get secret drawrace-iad-acb-kubeconfig \
  -o jsonpath='{.data.config}' | base64 -d > "$VERIFY_KUBECONFIG"

# Test access to iad-acb using the extracted kubeconfig
if KUBECONFIG="$VERIFY_KUBECONFIG" kubectl -n drawrace get configmap drawrace-client-key &>/dev/null; then
  log_info "✓ Verification successful: Can access drawrace-client-key ConfigMap on iad-acb"
else
  log_warn "⚠ Verification failed: Could not access drawrace-client-key ConfigMap"
  log_warn "This might be expected if the ConfigMap doesn't exist yet"
  log_warn "The secret setup is complete, but you may need to create the ConfigMap first"
fi

# Summary
echo ""
log_info "=== Setup Complete ==="
echo ""
log_info "The following resources have been created:"
echo "  - ServiceAccount: drawrace-rotate-key (namespace: drawrace, cluster: iad-acb)"
echo "  - Role: drawrace-rotate-key (namespace: drawrace, cluster: iad-acb)"
echo "  - RoleBinding: drawrace-rotate-key (namespace: drawrace, cluster: iad-acb)"
echo "  - Secret: drawrace-iad-acb-kubeconfig (namespace: argo-workflows, cluster: iad-ci)"
echo ""
log_info "The drawrace-build workflow can now update ConfigMaps on iad-acb from iad-ci"
echo ""
log_info "Next steps:"
echo "  1. Ensure the drawrace-client-key ConfigMap exists on iad-acb:"
echo "     kubectl --kubeconfig=$IAD_ACB_KUBECONFIG -n drawrace get configmap drawrace-client-key"
echo "  2. Run the drawrace-build workflow and verify the rotate-client-key step succeeds"
echo ""
