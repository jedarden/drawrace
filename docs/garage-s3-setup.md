# Garage S3 Key Setup for DrawRace

## Overview

This document explains how to create Garage S3 keys for the drawrace-pg-backups bucket on the ardenone-hub cluster.

## Infrastructure Context

- **Garage Cluster**: ardenone-hub (accessed via Tailscale)
- **Bucket**: drawrace-pg-backups
- **Purpose**: Store PostgreSQL backups from CloudNativePG
- **Secret Storage**: OpenBao on rs-manager cluster
- **ExternalSecret Sync**: external-secrets-operator in drawrace namespace

## Access Methods

### Method 1: Direct Garage CLI (Preferred)

If you have direct access to the ardenone-hub cluster or a machine with Garage CLI installed:

```bash
# Set Garage endpoint
export GARAGE_RPC_ENDPOINT=http://garage.ardenone-hub.svc:3900

# Create bucket (if not exists)
garage bucket create drawrace-pg-backups

# Create S3 key with access
garage key create --name drawrace-postgres-backup --allow-bucket drawrace-pg-backups
```

The `garage key create` command will output:
- **Access Key ID**: Your S3 access key
- **Secret Access Key**: Your S3 secret key

Save these credentials securely - you'll need them for the next step.

### Method 2: Via Kubectl on ardenone-hub

If you have kubectl access to ardenone-hub:

```bash
# Find a Garage pod
kubectl get pods -n garage | grep garage

# Exec into a Garage pod
kubectl exec -it <garage-pod-name> -n garage -- /bin/sh

# Inside the pod, run Garage CLI
garage key create --name drawrace-postgres-backup --allow-bucket drawrace-pg-backups
```

### Method 3: Via Tailscale Network

ardenone-hub is accessible via Tailscale. You may be able to access Garage services directly if you're on the Tailscale network:

```bash
# Try accessing Garage via Tailscale hostname
export GARAGE_RPC_ENDPOINT=http://garage.ardenone-hub.tail1b1987.ts.net:3900
garage key info  # Test connectivity
```

## Storing Credentials

Once you have the Access Key ID and Secret Access Key, use the provided script to store them in OpenBao:

```bash
./scripts/create-garage-s3-key.sh
```

The script will:
1. Prompt you for the Access Key ID and Secret Access Key
2. Store them in OpenBao at: `secret/rs-manager/drawrace/postgres-backup`
3. Trigger automatic sync to ExternalSecret `drawrace-postgres-backup-s3`

## Verification

### 1. Check OpenBao Secret
```bash
kubectl exec -n openbao openbao-rs-manager-0 -- \
    bao kv get secret/rs-manager/drawrace/postgres-backup
```

### 2. Check ExternalSecret Sync
```bash
kubectl get externalsecret drawrace-postgres-backup-s3 -n drawrace
```

Should show: `READY STATE: True`

### 3. Check Kubernetes Secret
```bash
kubectl get secret drawrace-postgres-backup-s3 -n drawrace
```

### 4. Verify Key Permissions

Test that the key has appropriate permissions for the drawrace-pg-backups bucket:

```bash
# Using AWS CLI or s3cmd with the new credentials
export AWS_ACCESS_KEY_ID=<your-access-key>
export AWS_SECRET_ACCESS_KEY=<your-secret-key>
export S3_ENDPOINT_URL=http://garage.ardenone-hub.svc:3900

# List buckets (should show drawrace-pg-backups)
aws s3 ls --endpoint-url $S3_ENDPOINT_URL

# Test write access
echo "test" > /tmp/test.txt
aws s3 cp /tmp/test.txt s3://drawrace-pg-backups/test --endpoint-url $S3_ENDPOINT_URL

# Clean up
aws s3 rm s3://drawrace-pg-backups/test --endpoint-url $S3_ENDPOINT_URL
```

## Troubleshooting

### "Unable to connect to Garage" Errors

- **Check ardenone-hub connectivity**: Ensure you can reach the cluster
- **Verify Tailscale connection**: `tailscale status`
- **Check Garage pod status**: `kubectl get pods -n garage` (if you have access)

### ExternalSecret Not Syncing

```bash
# Check external-secrets-operator logs
kubectl logs -n external-secrets deployment/external-secrets-operator

# Force sync
kubectl annotate externalsecret drawrace-postgres-backup-s3 \
    -n drawrace force-sync=$(date +%s) --overwrite
```

### Key Permission Issues

If the key doesn't have proper bucket access:

```bash
# Verify key permissions in Garage
garage key info <key-id>

# Create a new key with explicit permissions
garage key create --name drawrace-postgres-backup \
    --allow-bucket drawrace-pg-backups \
    --allow-read \
    --allow-write \
    --allow-delete
```

## Security Notes

- **Key Rotation**: Consider rotating S3 keys periodically
- **Access Scope**: This key should only have access to drawrace-pg-backups bucket
- **Monitoring**: Enable Garage access logging for audit trail
- **Backup**: Keep a secure backup of credentials in case OpenBao needs restoration

## Related Documentation

- [CLAUDE.md - Garage S3](../../CLAUDE.md#storage) - Infrastructure setup
- [Plan.md - Storage](../plan/plan.md#4-storage) - Architecture decisions
- [OpenBao Documentation](https://openbao.org/docs) - Secret management

## Maintenance

- **Monthly**: Review and rotate S3 keys
- **Quarterly**: Audit bucket access and clean up old keys
- **As needed**: Update key permissions if backup requirements change
