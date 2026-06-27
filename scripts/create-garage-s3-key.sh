#!/bin/bash
#
# create-garage-s3-key.sh
#
# This script creates a Garage S3 key for the drawrace-pg-backups bucket
# and stores it in OpenBao at the specified path.
#
# Prerequisites:
# - kubectl access to rs-manager cluster
# - OpenBao pod running in openbao namespace
# - Garage running on ardenone-hub cluster
#
# Usage:
#   ./scripts/create-garage-s3-key.sh
#

set -euo pipefail

# Configuration
BUCKET_NAME="drawrace-pg-backups"
OPENBAO_PATH="secret/rs-manager/drawrace/postgres-backup"
OPENBAO_NAMESPACE="openbao"
OPENBAO_POD="openbao-rs-manager-0"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    log_error "kubectl is not installed or not in PATH"
    exit 1
fi

# Check if we can access the OpenBao pod
log_info "Checking OpenBao pod availability..."
if ! kubectl get pod "$OPENBAO_POD" -n "$OPENBAO_NAMESPACE" &> /dev/null; then
    log_error "OpenBao pod $OPENBAO_POD not found in namespace $OPENBAO_NAMESPACE"
    log_error "Please ensure you have access to the rs-manager cluster"
    exit 1
fi

# Check if the bucket already exists
log_info "Checking if bucket $BUCKET_NAME exists..."
# Note: This assumes you have access to Garage via some method
# You may need to adjust this based on your Garage access setup

# Generate S3 credentials
log_info "Generating S3 credentials for bucket $BUCKET_NAME..."
log_warn "This step requires Garage CLI access on ardenone-hub cluster"
log_warn ""
log_warn "To create the Garage S3 key, you need to:"
log_warn "1. Access a machine with Garage CLI installed (typically ardenone-hub)"
log_warn "2. Run the following Garage CLI commands:"
log_warn ""
log_warn "   # Create the bucket if it doesn't exist"
log_warn "   garage bucket create $BUCKET_NAME"
log_warn ""
log_warn "   # Create a new S3 key with read-write access"
log_warn "   garage key create --name drawrace-postgres-backup --allow-bucket $BUCKET_NAME"
log_warn ""
log_warn "The garage key create command will output:"
log_warn "  - Access Key ID (accessKeyId)"
log_warn "  - Secret Access Key (secretAccessKey)"
log_warn ""
log_warn "Save these credentials securely - you'll need them below."
log_warn ""

# Prompt for credentials
read -p "Enter Access Key ID: " ACCESS_KEY_ID
read -sp "Enter Secret Access Key: " SECRET_ACCESS_KEY
echo

# Validate input
if [[ -z "$ACCESS_KEY_ID" || -z "$SECRET_ACCESS_KEY" ]]; then
    log_error "Access Key ID and Secret Access Key cannot be empty"
    exit 1
fi

# Store in OpenBao
log_info "Storing credentials in OpenBao at $OPENBAO_PATH..."
kubectl exec -n "$OPENBAO_NAMESPACE" "$OPENBAO_POD" -- \
    bao kv put "$OPENBAO_PATH" \
    accessKeyId="$ACCESS_KEY_ID" \
    secretAccessKey="$SECRET_ACCESS_KEY"

if [[ $? -eq 0 ]]; then
    log_info "✓ Secret created successfully!"
    log_info "Path: $OPENBAO_PATH"
    log_info ""
    log_info "The ExternalSecret 'drawrace-postgres-backup-s3' should now sync automatically."
    log_info "Verify with:"
    log_info "  kubectl get externalsecret drawrace-postgres-backup-s3 -n drawrace"
else
    log_error "Failed to create secret"
    exit 1
fi

# Verify the secret was created
log_info "Verifying secret..."
kubectl exec -n "$OPENBAO_NAMESPACE" "$OPENBAO_POD" -- \
    bao kv get "$OPENBAO_PATH"

log_info "Done!"
log_info ""
log_info "Next steps:"
log_info "1. Verify the ExternalSecret synced successfully:"
log_info "   kubectl get externalsecret drawrace-postgres-backup-s3 -n drawrace"
log_info ""
log_info "2. Check the Secret was created in the drawrace namespace:"
log_info "   kubectl get secret drawrace-postgres-backup-s3 -n drawrace"
log_info ""
log_info "3. Verify the Postgres backup configuration uses this secret"
log_info ""
log_info "4. Test S3 connectivity from the Postgres pod"
log_info ""
log_info "Troubleshooting:"
log_info "- If ExternalSecret doesn't sync, check external-secrets-operator logs"
log_info "- If bucket access fails, verify the key permissions in Garage"
log_info "- For Garage access issues, check ardenone-hub cluster connectivity"
