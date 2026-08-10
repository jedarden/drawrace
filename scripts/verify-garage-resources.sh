#!/bin/bash
# Garage Resources Verification Script
# This script verifies all Garage resources and extracts S3 credentials documentation

set -euo pipefail

CLUSTER_ENDPOINT="${CLUSTER_ENDPOINT:-http://traefik-iad-acb:8001}"
NAMESPACE="${NAMESPACE:-garage-operator}"

echo "=== DrawRace Garage Resources Verification ==="
echo "Cluster: $CLUSTER_ENDPOINT"
echo "Namespace: $NAMESPACE"
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check resource existence
check_resource() {
    local resource_type=$1
    local resource_name=$2

    if kubectl --server="$CLUSTER_ENDPOINT" get "$resource_type" "$resource_name" -n "$NAMESPACE" &>/dev/null; then
        echo -e "${GREEN}✓${NC} $resource_type/$resource_name exists"
        return 0
    else
        echo -e "${RED}✗${NC} $resource_type/$resource_name missing"
        return 1
    fi
}

# Function to check secret existence
check_secret() {
    local secret_name=$1

    if kubectl --server="$CLUSTER_ENDPOINT" get secret "$secret_name" -n "$NAMESPACE" &>/dev/null; then
        echo -e "${GREEN}✓${NC} Secret $secret_name exists"
        return 0
    else
        echo -e "${RED}✗${NC} Secret $secret_name missing"
        return 1
    fi
}

echo "=== Checking Garage Resources ==="
RESOURCES_OK=true

# Check GarageCluster
check_resource "garagecluster" "ardenone-hub" || RESOURCES_OK=false

# Check GarageBucket
check_resource "garagebucket" "drawrace-ghosts" || RESOURCES_OK=false

# Check GarageKeys
check_resource "garagekey" "drawrace-api-key" || RESOURCES_OK=false
check_resource "garagekey" "drawrace-postgres-backup-key" || RESOURCES_OK=false

echo ""
echo "=== Checking S3 Credential Secrets ==="
SECRETS_OK=true

# Check secrets created by GarageKeys
check_secret "drawrace-api-s3-credentials" || SECRETS_OK=false
check_secret "drawrace-postgres-backup-s3" || SECRETS_OK=false

echo ""
echo "=== Detailed Resource Information ==="

if $RESOURCES_OK; then
    echo "--- GarageBucket Details ---"
    kubectl --server="$CLUSTER_ENDPOINT" get garagebucket drawrace-ghosts -n "$NAMESPACE" -o jsonpath='{.metadata.name}{"\n"}Quota: {\.spec.quotas.maxSize}{"\n"}Versioning: {\.spec.versioning.enabled}{"\n"}GlobalAlias: {\.spec.globalAlias}{"\n\n"}'

    echo "--- GarageKey: drawrace-api-key ---"
    kubectl --server="$CLUSTER_ENDPOINT" get garagekey drawrace-api-key -n "$NAMESPACE" -o jsonpath='{.metadata.name}{"\n"}SecretName: {\.spec.secretName}{"\n"}Cluster: {\.spec.clusterRef.name}{"\n"}Permissions: {\.spec.bucketPermissions[0].permissions.read} / {\.spec.bucketPermissions[0].permissions.write}{"\n\n"}'

    echo "--- GarageKey: drawrace-postgres-backup-key ---"
    kubectl --server="$CLUSTER_ENDPOINT" get garagekey drawrace-postgres-backup-key -n "$NAMESPACE" -o jsonpath='{.metadata.name}{"\n"}SecretName: {\.spec.secretName}{"\n"}Cluster: {\.spec.clusterRef.name}{"\n"}Permissions: {\.spec.bucketPermissions[0].permissions.read} / {\.spec.bucketPermissions[0].permissions.write}{"\n\n"}'
fi

if $SECRETS_OK; then
    echo "--- Secret Details (Safe) ---"
    echo "API Credentials Secret:"
    kubectl --server="$CLUSTER_ENDPOINT" get secret drawrace-api-s3-credentials -n "$NAMESPACE" -o jsonpath='  Name: {.metadata.name}{"\n"}  Type: {.type}{"\n"}  Keys: {.data | keys | join(", ")}{"\n"}  Created: {.metadata.creationTimestamp}{"\n\n"}'

    echo "Postgres Backup Secret:"
    kubectl --server="$CLUSTER_ENDPOINT" get secret drawrace-postgres-backup-s3 -n "$NAMESPACE" -o jsonpath='  Name: {.metadata.name}{"\n"}  Type: {.type}{"\n"}  Keys: {.data | keys | join(", ")}{"\n"}  Created: {.metadata.creationTimestamp}{"\n\n"}'
fi

echo "=== Checking for Resource Conflicts ==="

# Check for duplicate bucket names
BUCKET_COUNT=$(kubectl --server="$CLUSTER_ENDPOINT" get garagebucket -n "$NAMESPACE" -o jsonpath='{.items}' 2>/dev/null | jq '. | length' 2>/dev/null || echo "0")
echo "Total GarageBuckets in namespace: $BUCKET_COUNT"

# Check for duplicate key names
KEY_COUNT=$(kubectl --server="$CLUSTER_ENDPOINT" get garagekey -n "$NAMESPACE" -o jsonpath='{.items}' 2>/dev/null | jq '. | length' 2>/dev/null || echo "0")
echo "Total GarageKeys in namespace: $KEY_COUNT"

echo ""
echo "=== Final Status ==="

if $RESOURCES_OK && $SECRETS_OK; then
    echo -e "${GREEN}✓ ALL CHECKS PASSED${NC}"
    echo "All Garage resources and S3 credentials are properly configured."
    exit 0
elif $RESOURCES_OK && ! $SECRETS_OK; then
    echo -e "${YELLOW}⚠ PARTIAL: Resources OK, Secrets missing${NC}"
    echo "Garage resources exist but S3 credential secrets may not be created yet."
    exit 1
elif ! $RESOURCES_OK && $SECRETS_OK; then
    echo -e "${YELLOW}⚠ PARTIAL: Secrets OK, Resources missing${NC}"
    echo "S3 credential secrets exist but Garage resources may be missing."
    exit 1
else
    echo -e "${RED}✗ VERIFICATION FAILED${NC}"
    echo "Both Garage resources and S3 credentials have issues."
    exit 2
fi
