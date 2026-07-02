# DrawRace OpenBao Secrets - Execution Checklist

**Purpose:** Create 3 OpenBao secrets required for DrawRace ExternalSecrets sync  
**Required Access:** OpenBao root token + cluster admin access to iad-acb  
**Estimated Time:** 10-15 minutes

---

## Pre-Execution Checklist

- [ ] OpenBao root token obtained from cluster admin
- [ ] Cluster admin access to iad-acb confirmed (`kubectl --server=http://traefik-iad-acb:8001 get nodes`)
- [ ] Current working directory: `/home/coding/drawrace`
- [ ] Script executable: `scripts/setup-openbao-secrets.sh` has execute permissions

---

## Execution Steps

### Step 1: Set OpenBao Token

```bash
export OPENBAO_TOKEN="<paste-root-token-here>"
```

- [ ] Token exported successfully

### Step 2: Verify Cluster Access

```bash
kubectl --server=http://traefik-iad-acb:8001 get namespace drawrace
```

Expected: No errors, namespace `drawrace` listed

- [ ] Cluster access confirmed

### Step 3: Run Automated Setup Script

```bash
cd /home/coding/drawrace
./scripts/setup-openbao-secrets.sh
```

Watch for:
- ✅ GarageBucket `drawrace-ghosts` created
- ✅ GarageKey `drawrace-api-key` created
- ✅ GarageKey `drawrace-postgres-backup-key` created
- ✅ OpenBao secrets populated
- ✅ Temporary secrets cleaned up
- ✅ All ExternalSecrets Ready

- [ ] Script completed successfully
- [ ] No error messages in output

### Step 4: Verify ExternalSecrets Synced

```bash
kubectl --server=http://traefik-iad-acb:8001 get externalsecrets -n drawrace
```

Expected output:
```
NAME                            STATUS              READY
docker-hub-registry             SecretSynced        True
drawrace-api-s3-credentials     SecretSynced        True
drawrace-postgres-backup-s3     SecretSynced        True
drawrace-postgres-credentials   SecretSynced        True
```

- [ ] All 4 ExternalSecrets show `SecretSynced` status
- [ ] All 4 ExternalSecrets show `Ready: True`

### Step 5: Verify Kubernetes Secrets Created

```bash
kubectl --server=http://traefik-iad-acb:8001 get secrets -n drawrace | grep drawrace
```

Expected:
```
drawrace-api-s3-credentials              Opaque    4
drawrace-postgres-backup-s3             Opaque    2
drawrace-postgres-credentials           kubernetes.io/basic-auth    2
```

- [ ] 3 DrawRace secrets created
- [ ] All secrets have correct data keys (4 for API S3, 2 for others)

### Step 6: Verify Secret Contents (Optional but Recommended)

```bash
# Decode and check Postgres credentials
kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-postgres-credentials -n drawrace -o jsonpath='{.data.username}' | base64 -d
kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-postgres-credentials -n drawrace -o jsonpath='{.data.password}' | base64 -d | cut -c1-8
```

Expected:
- Username: `drawrace`
- Password: 25-character alphanumeric string

- [ ] Postgres username is `drawrace`
- [ ] Postgres password is 25 characters

```bash
# Decode and check API S3 credentials
kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-api-s3-credentials -n drawrace -o jsonpath='{.data.AWS_ENDPOINT_URL}' | base64 -d
kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-api-s3-credentials -n drawrace -o jsonpath='{.data.AWS_REGION}' | base64 -d
```

Expected:
- Endpoint: Garage S3 URL (e.g., `https://s3.ardenone.com`)
- Region: `garage`

- [ ] S3 endpoint URL is valid
- [ ] S3 region is set to `garage`

### Step 7: Verify OpenBao Secrets Exist (Optional)

```bash
# Read API S3 secret from OpenBao
curl -s -X GET "http://openbao.external-secrets.svc.cluster.local:8200/v1/secret/data/rs-manager/drawrace/s3" \
  -H "X-Vault-Token: $OPENBAO_TOKEN" | jq '.data.data | keys'
```

Expected keys: `["AWS_ACCESS_KEY_ID", "AWS_ENDPOINT_URL", "AWS_REGION", "AWS_SECRET_ACCESS_KEY"]`

- [ ] All required keys present in OpenBao

```bash
# Read Postgres backup secret from OpenBao
curl -s -X GET "http://openbao.external-secrets.svc.cluster.local:8200/v1/secret/data/rs-manager/drawrace/postgres-backup" \
  -H "X-Vault-Token: $OPENBAO_TOKEN" | jq '.data.data | keys'
```

Expected keys: `["accessKeyId", "secretAccessKey"]`

- [ ] Postgres backup secret keys present

```bash
# Read Postgres credentials secret from OpenBao
curl -s -X GET "http://openbao.external-secrets.svc.cluster.local:8200/v1/secret/data/rs-manager/drawrace/postgres" \
  -H "X-Vault-Token: $OPENBAO_TOKEN" | jq '.data.data | keys'
```

Expected keys: `["password", "username"]`

- [ ] Postgres credentials secret keys present

---

## Post-Execution Verification

### Step 8: Verify ExternalSecrets Refreshing

Wait 2-3 minutes, then check:

```bash
kubectl --server=http://traefik-iad-acb:8001 get externalsecrets -n drawrace -o jsonpath='{range .items[*]}{.metadata.name}{"\tLAST SYNC: "}{.status.lastSync}{"\n"}{end}'
```

Expected:
- All ExternalSecrets show recent `LAST SYNC` timestamp (within last few minutes)

- [ ] ExternalSecrets are refreshing (timestamps are current)

### Step 9: Check ExternalSecret Operator Logs (If Issues)

```bash
kubectl logs -n external-secrets -l app.kubernetes.io/name=external-secrets --tail=20 | grep drawrace
```

- [ ] No error messages related to DrawRace secrets
- [ ] Sync operations logged successfully

### Step 10: Verify Garage Resources Created (Optional)

```bash
kubectl --server=http://traefik-iad-acb:8001 get garagebucket -n garage-operator | grep drawrace
kubectl --server=http://traefik-iad-acb:8001 get garagekey -n garage-operator | grep drawrace
```

Expected:
- `GarageBucket/drawrace-ghosts` present
- `GarageKey/drawrace-api-key` present
- `GarageKey/drawrace-postgres-backup-key` present

- [ ] All 3 Garage resources created

---

## Success Criteria

All of the following must be true:

- [ ] **Script Execution:** `setup-openbao-secrets.sh` completed without errors
- [ ] **ExternalSecret Sync:** All 3 failing ExternalSecrets now show `SecretSynced` status
- [ ] **Secret Creation:** All 3 Kubernetes secrets created in `drawrace` namespace
- [ ] **OpenBao Population:** All 3 secrets accessible in OpenBao at correct paths
- [ ] **Garage Resources:** Bucket and keys created for S3 access
- [ ] **No Errors:** No error messages in ExternalSecret operator logs

---

## Troubleshooting Quick Reference

### Issue: Script fails with "OPENBAO_TOKEN not set"

**Solution:**
```bash
export OPENBAO_TOKEN="<your-token>"
./scripts/setup-openbao-secrets.sh
```

### Issue: Script fails at "Checking cluster access"

**Solution:** Verify kubectl can access iad-acb cluster:
```bash
kubectl --server=http://traefik-iad-acb:8001 get nodes
```

### Issue: ExternalSecrets still show SecretSyncedError after script

**Diagnosis:**
```bash
kubectl --server=http://traefik-iad-acb:8001 get externalsecret drawrace-api-s3-credentials -n drawrace -o yaml | grep -A 3 "message:"
```

**Common fixes:**
- Verify OpenBao token is valid
- Check OpenBao service is reachable
- Verify secret paths in OpenBao match ExternalSecret remoteRef

### Issue: Temporary secrets not cleaned up

**Manual cleanup:**
```bash
kubectl --server=http://traefik-iad-acb:8001 delete secret drawrace-api-s3-temp -n garage-operator --ignore-not-found=true
kubectl --server=http://traefik-iad-acb:8001 delete secret drawrace-postgres-backup-s3-temp -n garage-operator --ignore-not-found=true
```

---

## Rollback Procedure (If Needed)

### Delete OpenBao Secrets

```bash
export OPENBAO_TOKEN="<your-token>"
curl -X DELETE "http://openbao.external-secrets.svc.cluster.local:8200/v1/secret/data/rs-manager/drawrace/s3" \
  -H "X-Vault-Token: $OPENBAO_TOKEN"
curl -X DELETE "http://openbao.external-secrets.svc.cluster.local:8200/v1/secret/data/rs-manager/drawrace/postgres-backup" \
  -H "X-Vault-Token: $OPENBAO_TOKEN"
curl -X DELETE "http://openbao.external-secrets.svc.cluster.local:8200/v1/secret/data/rs-manager/drawrace/postgres" \
  -H "X-Vault-Token: $OPENBAO_TOKEN"
```

### Delete Garage Resources

```bash
kubectl --server=http://traefik-iad-acb:8001 delete garagekey drawrace-api-key -n garage-operator
kubectl --server=http://traefik-iad-acb:8001 delete garagekey drawrace-postgres-backup-key -n garage-operator
kubectl --server=http://traefik-iad-acb:8001 delete garagebucket drawrace-ghosts -n garage-operator
```

---

## Completion Confirmation

**Executor:** _______________________  
**Date:** _______________________  
**OpenBao Token Source:** _______________________  

**Final Status:**

- [ ] All 3 OpenBao secrets created successfully
- [ ] All ExternalSecrets syncing correctly
- [ ] Kubernetes secrets verified
- [ ] No errors or warnings

**Notes:**
_________________________________________________________________
_________________________________________________________________
_________________________________________________________________

---

**Checklist Version:** 1.0  
**Last Updated:** 2026-07-02  
**Reference:** `docs/openbao-secrets-creation-guide.md`
