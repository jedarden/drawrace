# OpenBao Secrets Setup for DrawRace

## Overview

This document describes how to configure OpenBao secrets for DrawRace ExternalSecrets. Three ExternalSecrets are currently failing because their secrets don't exist in OpenBao:

1. `drawrace-api-s3-credentials` - S3 credentials for ghost blob storage (Garage)
2. `drawrace-postgres-backup-s3` - S3 credentials for Postgres backups
3. `drawrace-postgres-credentials` - Postgres database credentials

## Prerequisites

- Cluster admin access to iad-acb (or equivalent workload cluster)
- OpenBao root token (can be obtained from cluster admin)
- `kubectl` configured to access the cluster
- Garage operator already deployed on ardenone-cluster

## Automated Setup

The script `scripts/setup-openbao-secrets.sh` automates the entire setup process:

```bash
# Set your OpenBao root token
export OPENBAO_TOKEN="<your-openbao-root-token>"

# Run the setup script
./scripts/setup-openbao-secrets.sh
```

The script will:
1. Create GarageBucket `drawrace-ghosts` (50Gi quota, versioning enabled)
2. Create GarageKey `drawrace-api-key` for API S3 access
3. Create GarageKey `drawrace-postgres-backup-key` for backup S3 access
4. Extract S3 credentials from Garage-generated secrets
5. Generate secure Postgres credentials
6. Populate OpenBao with all required secrets
7. Verify ExternalSecrets sync successfully
8. Clean up temporary secrets

## Manual Setup Steps

If you prefer manual setup or need to troubleshoot, follow these steps:

### Step 1: Create Garage Resources

Create the S3 bucket and keys for DrawRace:

```bash
# Create GarageBucket for ghost storage
kubectl apply -f - <<EOF
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

# Create GarageKey for API access
kubectl apply -f - <<EOF
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

# Create GarageKey for Postgres backup (reuse cnpg-backups bucket)
kubectl apply -f - <<EOF
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
```

Wait for the GarageKey resources to create the secrets (~30 seconds).

### Step 2: Extract S3 Credentials

Extract the credentials from the Garage-generated secrets:

```bash
# API S3 credentials
export AWS_ACCESS_KEY_ID=$(kubectl get secret drawrace-api-s3-temp -n garage-operator -o jsonpath='{.data.ACCESS_KEY_ID}' | base64 -d)
export AWS_SECRET_ACCESS_KEY=$(kubectl get secret drawrace-api-s3-temp -n garage-operator -o jsonpath='{.data.SECRET_ACCESS_KEY}' | base64 -d)
export AWS_ENDPOINT_URL=$(kubectl get secret drawrace-api-s3-temp -n garage-operator -o jsonpath='{.data.S3_ENDPOINT}' | base64 -d)
export AWS_REGION="garage"

# Postgres backup S3 credentials
export BACKUP_ACCESS_KEY_ID=$(kubectl get secret drawrace-postgres-backup-s3-temp -n garage-operator -o jsonpath='{.data.ACCESS_KEY_ID}' | base64 -d)
export BACKUP_SECRET_ACCESS_KEY=$(kubectl get secret drawrace-postgres-backup-s3-temp -n garage-operator -o jsonpath='{.data.SECRET_ACCESS_KEY}' | base64 -d)
```

### Step 3: Generate Postgres Credentials

Generate secure credentials for the Drawrace Postgres database:

```bash
export POSTGRES_USERNAME="drawrace"
export POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
```

### Step 4: Populate OpenBao Secrets

Use the OpenBao API to create the required secrets. First, set your OpenBao token:

```bash
export OPENBAO_TOKEN="<your-root-token>"
export OPENBAO_ADDR="http://openbao.external-secrets.svc.cluster.local:8200"
```

Create the three secrets:

```bash
# S3 credentials for API
curl -X POST "$OPENBAO_ADDR/v1/secret/data/rs-manager/drawrace/s3" \
  -H "X-Vault-Token: $OPENBAO_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"data\": {
      \"AWS_ACCESS_KEY_ID\": \"$AWS_ACCESS_KEY_ID\",
      \"AWS_SECRET_ACCESS_KEY\": \"$AWS_SECRET_ACCESS_KEY\",
      \"AWS_ENDPOINT_URL\": \"$AWS_ENDPOINT_URL\",
      \"AWS_REGION\": \"$AWS_REGION\"
    }
  }"

# S3 credentials for Postgres backup
curl -X POST "$OPENBAO_ADDR/v1/secret/data/rs-manager/drawrace/postgres-backup" \
  -H "X-Vault-Token: $OPENBAO_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"data\": {
      \"accessKeyId\": \"$BACKUP_ACCESS_KEY_ID\",
      \"secretAccessKey\": \"$BACKUP_SECRET_ACCESS_KEY\"
    }
  }"

# Postgres credentials
curl -X POST "$OPENBAO_ADDR/v1/secret/data/rs-manager/drawrace/postgres" \
  -H "X-Vault-Token: $OPENBAO_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"data\": {
      \"username\": \"$POSTGRES_USERNAME\",
      \"password\": \"$POSTGRES_PASSWORD\"
    }
  }"
```

### Step 5: Verify ExternalSecrets Sync

Check that all three ExternalSecrets are now Ready:

```bash
kubectl get externalsecrets -n drawrace
```

Expected output:
```
NAME                            STORETYPE            STORE     REFRESH INTERVAL   STATUS              READY   LAST SYNC
docker-hub-registry             ClusterSecretStore   openbao   1h                 SecretSynced        True    31m
drawrace-api-s3-credentials     ClusterSecretStore   openbao   1h                 SecretSynced        True    <now>
drawrace-postgres-backup-s3     ClusterSecretStore   openbao   1h                 SecretSynced        True    <now>
drawrace-postgres-credentials   ClusterSecretStore   openbao   1h                 SecretSynced        True    <now>
```

### Step 6: Verify Kubernetes Secrets Created

Check that the Kubernetes secrets were created:

```bash
kubectl get secrets -n drawrace | grep drawrace
```

Expected output:
```
drawrace-api-s3-credentials              Opaque                                4      2m
drawrace-postgres-backup-s3             Opaque                                2      2m
drawrace-postgres-credentials           kubernetes.io/basic-auth              2      2m
```

### Step 7: Cleanup Temporary Secrets

Remove the temporary Garage secrets:

```bash
kubectl delete secret drawrace-api-s3-temp -n garage-operator
kubectl delete secret drawrace-postgres-backup-s3-temp -n garage-operator
```

## OpenBao Secret Paths

The secrets are stored at these OpenBao KV paths:

- `secret/rs-manager/drawrace/s3` - S3 credentials for API
- `secret/rs-manager/drawrace/postgres-backup` - S3 credentials for Postgres backup
- `secret/rs-manager/drawrace/postgres` - Postgres database credentials

These paths match the `remoteRef.key` fields in the ExternalSecret definitions.

## Verification

After setup, verify that the ExternalSecrets are working correctly:

1. **Check ExternalSecret status:**
   ```bash
   kubectl get externalsecrets -n drawrace
   ```
   All three should show `STATUS: SecretSynced` and `READY: True`.

2. **Check Kubernetes secrets exist:**
   ```bash
   kubectl get secrets -n drawrace
   ```
   Should see the three drawrace secrets.

3. **Check secret contents:**
   ```bash
   kubectl get secret drawrace-postgres-credentials -n drawrace -o jsonpath='{.data}' | jq
   ```
   Should decode to show `username` and `password`.

## Troubleshooting

### ExternalSecret stuck in SecretSyncedError

Check the ExternalSecret status for error details:
```bash
kubectl get externalsecret drawrace-api-s3-credentials -n drawrace -o yaml
```

Common issues:
- **Secret doesn't exist in OpenBao:** Verify the secret path is correct
- **OpenBao authentication issue:** Check ClusterSecretStore status
- **Property name mismatch:** Verify property names match the OpenBao secret keys

### Verify OpenBao ClusterSecretStore

Check that the OpenBao ClusterSecretStore is healthy:
```bash
kubectl get clustersecretstore openbao -o yaml
```

Should show `status: conditions: - type: Ready, status: "True"`.

### Check OpenBao connectivity

From a pod in the cluster, test OpenBao connectivity:
```bash
kubectl run curl-test --image=curlimages/curl --rm -it --restart=Never -- \
  curl -v http://openbao.external-secrets.svc.cluster.local:8200/v1/sys/health
```

## Security Notes

- Postgres password is generated using `openssl rand` for cryptographic security
- S3 credentials are automatically generated by Garage operator
- OpenBao root token should be stored securely and rotated regularly
- Consider using OpenBao policies for least-privilege access instead of root token

## References

- ExternalSecrets definition: `declarative-config/k8s/iad-acb/drawrace/drawrace-externalsecrets.yml`
- OpenBao DR runbook: `declarative-config/k8s/openbao-dr-runbook.md`
- Garage operator documentation: `declarative-config/k8s/ardenone-cluster/garage-operator/`
