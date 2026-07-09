# OpenBao Secrets Creation Guide for DrawRace

## Executive Summary

This guide provides step-by-step instructions to create the required OpenBao secrets for DrawRace. **Three ExternalSecrets are currently failing** because their secrets don't exist in OpenBao:

- `drawrace-api-s3-credentials` - S3 credentials for API ghost blob storage
- `drawrace-postgres-backup-s3` - S3 credentials for Postgres backups  
- `drawrace-postgres-credentials` - Postgres database credentials

**Prerequisites:** OpenBao root token and cluster admin access to iad-acb.

---

## Quick Reference: Secret Paths

| ExternalSecret | OpenBao Path | Required Keys |
|----------------|--------------|---------------|
| `drawrace-api-s3-credentials` | `secret/data/rs-manager/drawrace/s3` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL`, `AWS_REGION` |
| `drawrace-postgres-backup-s3` | `secret/data/rs-manager/drawrace/postgres-backup` | `accessKeyId`, `secretAccessKey` |
| `drawrace-postgres-credentials` | `secret/data/rs-manager/drawrace/postgres` | `username`, `password` |

---

## Prerequisites Checklist

Before starting, ensure you have:

- [ ] **OpenBao root token** - Obtain from cluster admin
- [ ] **Cluster admin access** to `iad-acb` workload cluster
- [ ] **kubectl** configured to access `iad-acb` cluster
- [ ] **curl** installed (for OpenBao API calls)
- [ ] **openssl** installed (for Postgres password generation)

---

## Method 1: Automated Setup (Recommended)

The automated script handles everything: Garage resource creation, credential generation, and OpenBao population.

### Step 1: Set OpenBao Token

```bash
export OPENBAO_TOKEN="<your-openbao-root-token>"
```

### Step 2: Run Setup Script

```bash
cd /home/coding/drawrace
./scripts/setup-openbao-secrets.sh
```

The script will:
1. Create `GarageBucket drawrace-ghosts` (50Gi quota, versioning enabled)
2. Create `GarageKey drawrace-api-key` for API S3 access
3. Create `GarageKey drawrace-postgres-backup-key` for backup S3 access
4. Extract S3 credentials from Garage-generated secrets
5. Generate secure Postgres credentials
6. Populate OpenBao with all required secrets
7. Verify ExternalSecrets sync successfully
8. Clean up temporary secrets

### Step 3: Verify Success

```bash
kubectl --server=http://traefik-iad-acb:8001 get externalsecrets -n drawrace
```

Expected output:
```
NAME                            STORETYPE            STORE     REFRESH INTERVAL   STATUS              READY   LAST SYNC
docker-hub-registry             ClusterSecretStore   openbao   1h                 SecretSynced        True    44m
drawrace-api-s3-credentials     ClusterSecretStore   openbao   1h                 SecretSynced        True    <now>
drawrace-postgres-backup-s3     ClusterSecretStore   openbao   1h                 SecretSynced        True    <now>
drawrace-postgres-credentials   ClusterSecretStore   openbao   1h                 SecretSynced        True    <now>
```

---

## Method 2: Manual Setup

If you prefer manual setup or need to troubleshoot, follow these detailed steps.

### Phase 1: Create Garage Resources

#### Step 1.1: Create GarageBucket for Ghost Storage

```bash
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
```

#### Step 1.2: Create GarageKey for API Access

```bash
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
```

#### Step 1.3: Create GarageKey for Postgres Backup

```bash
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
```

#### Step 1.4: Wait for GarageKey Secrets Creation

```bash
# Wait for secrets to be created (usually 10-30 seconds)
sleep 30

# Verify secrets exist
kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-api-s3-temp -n garage-operator
kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-postgres-backup-s3-temp -n garage-operator
```

---

### Phase 2: Extract S3 Credentials

```bash
# Extract API S3 credentials
export AWS_ACCESS_KEY_ID=$(kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-api-s3-temp -n garage-operator -o jsonpath='{.data.ACCESS_KEY_ID}' | base64 -d)
export AWS_SECRET_ACCESS_KEY=$(kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-api-s3-temp -n garage-operator -o jsonpath='{.data.SECRET_ACCESS_KEY}' | base64 -d)
export AWS_ENDPOINT_URL=$(kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-api-s3-temp -n garage-operator -o jsonpath='{.data.S3_ENDPOINT}' | base64 -d)
export AWS_REGION="garage"

# Extract Postgres backup S3 credentials
export BACKUP_ACCESS_KEY_ID=$(kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-postgres-backup-s3-temp -n garage-operator -o jsonpath='{.data.ACCESS_KEY_ID}' | base64 -d)
export BACKUP_SECRET_ACCESS_KEY=$(kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-postgres-backup-s3-temp -n garage-operator -o jsonpath='{.data.SECRET_ACCESS_KEY}' | base64 -d)

# Verify extractions
echo "API S3 Access Key: ${AWS_ACCESS_KEY_ID:0:8}..."
echo "API S3 Endpoint: $AWS_ENDPOINT_URL"
echo "Backup S3 Access Key: ${BACKUP_ACCESS_KEY_ID:0:8}..."
```

---

### Phase 3: Generate Postgres Credentials

```bash
# Generate secure random password
export POSTGRES_USERNAME="drawrace"
export POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)

# Verify generation
echo "Postgres Username: $POSTGRES_USERNAME"
echo "Postgres Password: ${POSTGRES_PASSWORD:0:8}..."
```

---

### Phase 4: Populate OpenBao Secrets

#### Step 4.1: Set OpenBao Connection Parameters

```bash
export OPENBAO_TOKEN="<your-openbao-root-token>"
export OPENBAO_ADDR="http://openbao.external-secrets.svc.cluster.local:8200"
```

#### Step 4.2: Create API S3 Credentials Secret

```bash
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
  }"
```

Expected response: `{"request_id":"...","lease_id":"...","renewable":false,"lease_duration":0,"data":{...},"wrap_info":null,"warnings":null,"auth":null}`

#### Step 4.3: Create Postgres Backup S3 Credentials Secret

```bash
curl -s -X POST "$OPENBAO_ADDR/v1/secret/data/rs-manager/drawrace/postgres-backup" \
  -H "X-Vault-Token: $OPENBAO_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"data\": {
      \"accessKeyId\": \"$BACKUP_ACCESS_KEY_ID\",
      \"secretAccessKey\": \"$BACKUP_SECRET_ACCESS_KEY\"
    }
  }"
```

#### Step 4.4: Create Postgres Database Credentials Secret

```bash
curl -s -X POST "$OPENBAO_ADDR/v1/secret/data/rs-manager/drawrace/postgres" \
  -H "X-Vault-Token: $OPENBAO_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"data\": {
      \"username\": \"$POSTGRES_USERNAME\",
      \"password\": \"$POSTGRES_PASSWORD\"
    }
  }"
```

---

### Phase 5: Verify ExternalSecrets Sync

```bash
# Watch sync progress (should complete within 1-2 minutes)
watch -n 5 'kubectl --server=http://traefik-iad-acb:8001 get externalsecrets -n drawrace'
```

Expected final state:
```
Every 5.0s: kubectl --server=http://traefik-iad-acb:8001 get externalsecrets -n drawrace

NAME                            STORETYPE            STORE     REFRESH INTERVAL   STATUS              READY   LAST SYNC
docker-hub-registry             ClusterSecretStore   openbao   1h                 SecretSynced        True    44m
drawrace-api-s3-credentials     ClusterSecretStore   openbao   1h                 SecretSynced        True    <now>
drawrace-postgres-backup-s3     ClusterSecretStore   openbao   1h                 SecretSynced        True    <now>
drawrace-postgres-credentials   ClusterSecretStore   openbao   1h                 SecretSynced        True    <now>
```

---

### Phase 6: Verify Kubernetes Secrets Created

```bash
kubectl --server=http://traefik-iad-acb:8001 get secrets -n drawrace | grep drawrace
```

Expected output:
```
drawrace-api-s3-credentials              Opaque                                4      2m
drawrace-postgres-backup-s3             Opaque                                2      2m
drawrace-postgres-credentials           kubernetes.io/basic-auth              2      2m
```

---

### Phase 7: Cleanup Temporary Secrets

```bash
kubectl --server=http://traefik-iad-acb:8001 delete secret drawrace-api-s3-temp -n garage-operator
kubectl --server=http://traefik-iad-acb:8001 delete secret drawrace-postgres-backup-s3-temp -n garage-operator
```

---

## Verification Procedures

### 1. Verify ExternalSecret Status

```bash
kubectl --server=http://traefik-iad-acb:8001 get externalsecrets -n drawrace -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.conditions[0].type}{"="}{.status.conditions[0].status}{"\n"}{end}'
```

Expected output:
```
docker-hub-registry	Ready=True
drawrace-api-s3-credentials	Ready=True
drawrace-postgres-backup-s3	Ready=True
drawrace-postgres-credentials	Ready=True
```

### 2. Verify Kubernetes Secret Contents

```bash
# Check Postgres credentials
kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-postgres-credentials -n drawrace -o jsonpath='{.data}' | jq

# Check API S3 credentials
kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-api-s3-credentials -n drawrace -o jsonpath='{.data}' | jq
```

### 3. Test OpenBao Secret Read

```bash
# Test reading API S3 secret from OpenBao
curl -s -X GET "$OPENBAO_ADDR/v1/secret/data/rs-manager/drawrace/s3" \
  -H "X-Vault-Token: $OPENBAO_TOKEN" | jq '.data.data'
```

---

## Troubleshooting

### Issue: ExternalSecret stuck in SecretSyncedError

**Symptom:** `kubectl get externalsecrets -n drawrace` shows `SecretSyncedError` status.

**Diagnosis:**
```bash
kubectl --server=http://traefik-iad-acb:8001 get externalsecret drawrace-api-s3-credentials -n drawrace -o yaml | grep -A 5 "status:"
```

**Common Causes:**

1. **Secret doesn't exist in OpenBao**
   ```bash
   # Verify secret exists
   curl -s -X GET "$OPENBAO_ADDR/v1/secret/data/rs-manager/drawrace/s3" \
     -H "X-Vault-Token: $OPENBAO_TOKEN"
   ```
   **Fix:** Create the secret using Phase 4 steps.

2. **OpenBao authentication issue**
   ```bash
   # Verify ClusterSecretStore status
   kubectl get clustersecretstore openbao -o yaml | grep -A 10 "status:"
   ```
   **Fix:** Check OpenBao token validity and ClusterSecretStore configuration.

3. **Property name mismatch**
   ```bash
   # Compare ExternalSecret remoteRef with OpenBao secret keys
   kubectl get externalsecret drawrace-api-s3-credentials -n drawrace -o yaml | grep -A 3 "remoteRef:"
   ```
   **Fix:** Ensure property names match exactly (case-sensitive).

### Issue: GarageKey Secret Not Created

**Symptom:** `kubectl get secret drawrace-api-s3-temp -n garage-operator` returns `NotFound`.

**Diagnosis:**
```bash
kubectl --server=http://traefik-iad-acb:8001 get garagekey drawrace-api-key -n garage-operator -o yaml | grep -A 5 "status:"
```

**Common Causes:**

1. **Garage cluster not ready**
   ```bash
   kubectl get garage -n garage-operator
   ```
   **Fix:** Wait for Garage cluster to become Ready.

2. **Insufficient permissions**
   **Fix:** Ensure you have cluster-admin privileges.

### Issue: ExternalSecret Sync Timeout

**Symptom:** ExternalSecret takes > 5 minutes to sync.

**Diagnosis:**
```bash
# Check ExternalSecret operator logs
kubectl logs -n external-secrets -l app.kubernetes.io/name=external-secrets --tail=50
```

**Fix:**
- Restart ExternalSecret operator pod
- Check OpenBao service connectivity
- Verify refreshInterval is set correctly (should be `1h`)

---

## Security Considerations

1. **OpenBao Root Token:**
   - Treat as highly sensitive credential
   - Store securely (e.g., in password manager)
   - Rotate regularly
   - Never commit to version control

2. **Generated Credentials:**
   - Postgres password is generated using `openssl rand` (cryptographically secure)
   - S3 credentials are automatically generated by Garage operator
   - All credentials are stored in OpenBao with access controls

3. **Temporary Secrets:**
   - GarageKey temporary secrets are deleted after use
   - Ensure cleanup is performed (Phase 7)

4. **Access Controls:**
   - ExternalSecret operator service account has limited read-only access to OpenBao secrets
   - Consider implementing OpenBao policies for least-privilege access

---

## Rollback Procedure

If you need to rollback the secret creation:

### 1. Delete OpenBao Secrets

```bash
curl -s -X DELETE "$OPENBAO_ADDR/v1/secret/data/rs-manager/drawrace/s3" \
  -H "X-Vault-Token: $OPENBAO_TOKEN"

curl -s -X DELETE "$OPENBAO_ADDR/v1/secret/data/rs-manager/drawrace/postgres-backup" \
  -H "X-Vault-Token: $OPENBAO_TOKEN"

curl -s -X DELETE "$OPENBAO_ADDR/v1/secret/data/rs-manager/drawrace/postgres" \
  -H "X-Vault-Token: $OPENBAO_TOKEN"
```

### 2. Delete Kubernetes Secrets (Optional)

ExternalSecrets will automatically delete target secrets when sync fails, but you can manually delete:

```bash
kubectl --server=http://traefik-iad-acb:8001 delete secret drawrace-api-s3-credentials -n drawrace
kubectl --server=http://traefik-iad-acb:8001 delete secret drawrace-postgres-backup-s3 -n drawrace
kubectl --server=http://traefik-iad-acb:8001 delete secret drawrace-postgres-credentials -n drawrace
```

### 3. Delete Garage Resources (Optional)

```bash
kubectl --server=http://traefik-iad-acb:8001 delete garagekey drawrace-api-key -n garage-operator
kubectl --server=http://traefik-iad-acb:8001 delete garagekey drawrace-postgres-backup-key -n garage-operator
kubectl --server=http://traefik-iad-acb:8001 delete garagebucket drawrace-ghosts -n garage-operator
```

---

## Success Criteria

After completing this guide, you should have:

- [x] All 3 OpenBao secrets created at the correct paths
- [x] All 3 ExternalSecrets showing `SecretSynced` status
- [x] All 3 Kubernetes secrets created in the `drawrace` namespace
- [x] ExternalSecret operator able to refresh secrets every hour
- [x] DrawRace deployments able to access required credentials

---

## Next Steps

After successful secret creation:

1. **Verify DrawRace Deployment:**
   ```bash
   kubectl --server=http://traefik-iad-acb:8001 get deployments -n drawrace
   ```

2. **Check Pod Status:**
   ```bash
   kubectl --server=http://traefik-iad-acb:8001 get pods -n drawrace
   ```

3. **Verify Application Logs:**
   ```bash
   kubectl --server=http://traefik-iad-acb:8001 logs -n drawrace -l app=drawrace-api --tail=50
   ```

4. **Test API Connectivity:**
   ```bash
   curl https://api-drawrace.ardenone.com/v1/health
   ```

---

## References

- ExternalSecrets definition: `k8s/iad-acb/drawrace/drawrace-externalsecrets.yml`
- OpenBao documentation: https://openbao.org/docs/
- Garage operator documentation: `declarative-config/k8s/ardenone-cluster/garage-operator/`
- Setup script: `scripts/setup-openbao-secrets.sh`

---

**Document Version:** 1.0  
**Last Updated:** 2026-07-02  
**Maintained By:** DrawRace Infrastructure Team
