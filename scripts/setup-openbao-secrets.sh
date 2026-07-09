#!/bin/bash
# Setup OpenBao secrets for DrawRace
# This script creates the necessary Garage resources, Postgres credentials,
# and populates OpenBao with the required secrets.

set -euo pipefail

# Configuration
DRAWRACE_NAMESPACE="drawrace"
GARAGE_NAMESPACE="garage-operator"
OPENBAO_NAMESPACE="tailscale"  # Where OpenBao is running
OPENBAO_POD="ts-openbao-wg482-0"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Check if we have cluster admin access
check_access() {
    log "Checking cluster access..."

    if ! kubectl --server=http://traefik-iad-acb:8001 get namespace "$DRAWRACE_NAMESPACE" >/dev/null 2>&1; then
        error "Cannot access drawrace namespace. This script requires write access to the cluster."
    fi

    log "Cluster access confirmed."
}

# Create Garage resources
create_garage_resources() {
    log "Creating Garage resources for DrawRace..."

    # Check if bucket already exists
    if kubectl --server=http://traefik-iad-acb:8001 get garagebucket drawrace-ghosts -n "$GARAGE_NAMESPACE" >/dev/null 2>&1; then
        log "GarageBucket drawrace-ghosts already exists, skipping..."
    else
        log "Creating GarageBucket drawrace-ghosts..."
        kubectl --server=http://traefik-iad-acb:8001 apply -f - <<EOF
apiVersion: garage.rajsingh.info/v1beta0
kind: GarageBucket
metadata:
  name: drawrace-ghosts
  namespace: garage-operator
spec:
  clusterRef:
    name: garage
  quotas:
    maxSize: 50Gi
  versioning:
    enabled: true
EOF
    fi

    # Create GarageKey for API access
    if kubectl --server=http://traefik-iad-acb:8001 get garagekey drawrace-api-key -n "$GARAGE_NAMESPACE" >/dev/null 2>&1; then
        log "GarageKey drawrace-api-key already exists, skipping..."
    else
        log "Creating GarageKey drawrace-api-key..."
        kubectl --server=http://traefik-iad-acb:8001 apply -f - <<EOF
apiVersion: garage.rajsingh.info/v1beta0
kind: GarageKey
metadata:
  name: drawrace-api-key
  namespace: garage-operator
spec:
  clusterRef:
    name: garage
  name: "DrawRace API S3 Key"
  secretTemplate:
    name: drawrace-api-s3-temp
    accessKeyIdKey: ACCESS_KEY_ID
    secretAccessKeyKey: SECRET_ACCESS_KEY
    endpointKey: S3_ENDPOINT
    includeEndpoint: true
  bucketPermissions:
    - bucketRef:
        name: drawrace-ghosts
      read: true
      write: true
EOF
    fi

    # Create GarageKey for Postgres backup (reuse CNPG backup bucket)
    if kubectl --server=http://traefik-iad-acb:8001 get garagekey drawrace-postgres-backup-key -n "$GARAGE_NAMESPACE" >/dev/null 2>&1; then
        log "GarageKey drawrace-postgres-backup-key already exists, skipping..."
    else
        log "Creating GarageKey drawrace-postgres-backup-key..."
        kubectl --server=http://traefik-iad-acb:8001 apply -f - <<EOF
apiVersion: garage.rajsingh.info/v1beta0
kind: GarageKey
metadata:
  name: drawrace-postgres-backup-key
  namespace: garage-operator
spec:
  clusterRef:
    name: garage
  name: "DrawRace Postgres Backup S3 Key"
  secretTemplate:
    name: drawrace-postgres-backup-s3-temp
    accessKeyIdKey: ACCESS_KEY_ID
    secretAccessKeyKey: SECRET_ACCESS_KEY
    endpointKey: S3_ENDPOINT
    includeEndpoint: true
  bucketPermissions:
    - bucketRef:
        name: cnpg-backups
      read: true
      write: true
EOF
    fi

    log "Waiting for GarageKey secrets to be created..."
    sleep 10
}

# Extract S3 credentials from Garage-generated secrets
extract_s3_credentials() {
    log "Extracting S3 credentials from Garage secrets..."

    # Get API S3 credentials
    if kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-api-s3-temp -n "$GARAGE_NAMESPACE" >/dev/null 2>&1; then
        AWS_ACCESS_KEY_ID=$(kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-api-s3-temp -n "$GARAGE_NAMESPACE" -o jsonpath='{.data.ACCESS_KEY_ID}' | base64 -d)
        AWS_SECRET_ACCESS_KEY=$(kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-api-s3-temp -n "$GARAGE_NAMESPACE" -o jsonpath='{.data.SECRET_ACCESS_KEY}' | base64 -d)
        AWS_ENDPOINT_URL=$(kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-api-s3-temp -n "$GARAGE_NAMESPACE" -o jsonpath='{.data.S3_ENDPOINT}' | base64 -d)
        AWS_REGION="garage"

        log "API S3 credentials extracted successfully."
    else
        error "Failed to find drawrace-api-s3-temp secret. GarageKey may not have created it yet."
    fi

    # Get Postgres backup S3 credentials
    if kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-postgres-backup-s3-temp -n "$GARAGE_NAMESPACE" >/dev/null 2>&1; then
        BACKUP_ACCESS_KEY_ID=$(kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-postgres-backup-s3-temp -n "$GARAGE_NAMESPACE" -o jsonpath='{.data.ACCESS_KEY_ID}' | base64 -d)
        BACKUP_SECRET_ACCESS_KEY=$(kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-postgres-backup-s3-temp -n "$GARAGE_NAMESPACE" -o jsonpath='{.data.SECRET_ACCESS_KEY}' | base64 -d)

        log "Postgres backup S3 credentials extracted successfully."
    else
        error "Failed to find drawrace-postgres-backup-s3-temp secret."
    fi
}

# Generate Postgres credentials
generate_postgres_credentials() {
    log "Generating Postgres credentials..."

    # Generate secure random password
    POSTGRES_USERNAME="drawrace"
    POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)

    log "Postgres credentials generated."
}

# Populate OpenBao secrets
populate_openbao_secrets() {
    log "Populating OpenBao secrets..."

    # Get OpenBao root token (this needs to be provided or obtained securely)
    if [ -z "${OPENBAO_TOKEN:-}" ]; then
        error "OPENBAO_TOKEN environment variable not set. Please set it with a valid OpenBao root token."
    fi

    # OpenBao endpoint (via Kubernetes service)
    OPENBAO_ADDR="http://openbao.external-secrets.svc.cluster.local:8200"

    # Write S3 credentials for API
    log "Writing rs-manager/drawrace/s3 to OpenBao..."
    curl -s -X POST "$OPENBAO_ADDR/v1/secret/data/rs-manager/drawrace/s3" \
        -H "X-Vault-Token: $OPENBAO_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"data\": {
                \"AWS_ACCESS_KEY_ID\": \"$AWS_ACCESS_KEY_ID\",
                \"AWS_SECRET_ACCESS_KEY\": \"$AWS_SECRET_ACCESS_KEY\",
                \"AWS_ENDPOINT_URL\": \"$AWS_ENDPOINT_URL\",
                \"AWS_REGION\": \"$AWS_REGION\"
            }
        }" >/dev/null

    # Write S3 credentials for Postgres backup
    log "Writing rs-manager/drawrace/postgres-backup to OpenBao..."
    curl -s -X POST "$OPENBAO_ADDR/v1/secret/data/rs-manager/drawrace/postgres-backup" \
        -H "X-Vault-Token: $OPENBAO_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"data\": {
                \"accessKeyId\": \"$BACKUP_ACCESS_KEY_ID\",
                \"secretAccessKey\": \"$BACKUP_SECRET_ACCESS_KEY\"
            }
        }" >/dev/null

    # Write Postgres credentials
    log "Writing rs-manager/drawrace/postgres to OpenBao..."
    curl -s -X POST "$OPENBAO_ADDR/v1/secret/data/rs-manager/drawrace/postgres" \
        -H "X-Vault-Token: $OPENBAO_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"data\": {
                \"username\": \"$POSTGRES_USERNAME\",
                \"password\": \"$POSTGRES_PASSWORD\"
            }
        }" >/dev/null

    log "OpenBao secrets populated successfully."
}

# Verify ExternalSecrets sync
verify_external_secrets() {
    log "Verifying ExternalSecrets are syncing..."

    # Wait up to 2 minutes for ExternalSecrets to sync
    for i in {1..12}; do
        log "Check attempt $i/12..."

        API_STATUS=$(kubectl --server=http://traefik-iad-acb:8001 get externalsecret drawrace-api-s3-credentials -n "$DRAWRACE_NAMESPACE" -o jsonpath='{.status.conditions[0].status}')
        PG_BACKUP_STATUS=$(kubectl --server=http://traefik-iad-acb:8001 get externalsecret drawrace-postgres-backup-s3 -n "$DRAWRACE_NAMESPACE" -o jsonpath='{.status.conditions[0].status}')
        PG_STATUS=$(kubectl --server=http://traefik-iad-acb:8001 get externalsecret drawrace-postgres-credentials -n "$DRAWRACE_NAMESPACE" -o jsonpath='{.status.conditions[0].status}')

        if [ "$API_STATUS" = "True" ] && [ "$PG_BACKUP_STATUS" = "True" ] && [ "$PG_STATUS" = "True" ]; then
            log "✅ All ExternalSecrets are now Ready!"
            return 0
        fi

        log "API S3: $API_STATUS, Postgres Backup S3: $PG_BACKUP_STATUS, Postgres: $PG_STATUS"
        sleep 10
    done

    error "ExternalSecrets did not sync within 2 minutes. Please check manually."
}

# Cleanup temporary secrets
cleanup_temp_secrets() {
    log "Cleaning up temporary Garage secrets..."

    kubectl --server=http://traefik-iad-acb:8001 delete secret drawrace-api-s3-temp -n "$GARAGE_NAMESPACE" --ignore-not-found=true
    kubectl --server=http://traefik-iad-acb:8001 delete secret drawrace-postgres-backup-s3-temp -n "$GARAGE_NAMESPACE" --ignore-not-found=true

    log "Temporary secrets cleaned up."
}

# Main execution
main() {
    log "Starting DrawRace OpenBao secrets setup..."

    check_access
    create_garage_resources
    extract_s3_credentials
    generate_postgres_credentials
    populate_openbao_secrets
    cleanup_temp_secrets
    verify_external_secrets

    log "✅ DrawRace OpenBao secrets setup completed successfully!"
    log ""
    log "Summary:"
    log "  - GarageBucket 'drawrace-ghosts' created"
    log "  - GarageKey 'drawrace-api-key' created"
    log "  - GarageKey 'drawrace-postgres-backup-key' created"
    log "  - OpenBao secrets populated at:"
    log "    • secret/rs-manager/drawrace/s3"
    log "    • secret/rs-manager/drawrace/postgres-backup"
    log "    • secret/rs-manager/drawrace/postgres"
    log "  - All ExternalSecrets are now Ready"
}

# Run main function
main "$@"
