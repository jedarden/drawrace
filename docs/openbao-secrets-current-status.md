# DrawRace OpenBao Secrets - Current Status and Action Required

## Current Situation (2026-08-10)

**Blocker:** OpenBao root token required to complete DrawRace ExternalSecret configuration.

### What Needs to Be Done

The DrawRace deployment requires 3 ExternalSecrets to be properly configured, but they are currently failing because the corresponding secrets don't exist in OpenBao:

1. `drawrace-api-s3-credentials` - S3 credentials for ghost blob storage (Garage)
2. `drawrace-postgres-backup-s3` - S3 credentials for Postgres backups  
3. `drawrace-postgres-credentials` - Postgres database credentials

### Required Action

**Contact the cluster admin** to obtain the OpenBao root token. This token is needed to:
- Create secret paths in OpenBao at `secret/data/rs-manager/drawrace/...`
- Populate the secrets with required credentials
- Enable ExternalSecret operator to sync the secrets to Kubernetes

## Setup Process (Once Token is Obtained)

### Automated Setup (Recommended)

The setup script at `scripts/setup-openbao-secrets.sh` automates the entire process:

```bash
# Set the OpenBao root token (obtained from cluster admin)
export OPENBAO_TOKEN="<paste-root-token-here>"

# Run the automated setup script
cd /home/coding/drawrace
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

### Manual Setup (Alternative)

If the automated script fails, follow the manual process documented in:
- `docs/openbao-secrets-creation-guide.md` - Detailed step-by-step manual setup
- `docs/setup-openbao-secrets.md` - Alternate manual setup guide

## Verification Steps

After setup is complete, verify the ExternalSecrets are syncing:

```bash
# Check ExternalSecret status
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

## OpenBao Secret Paths to be Created

| ExternalSecret | OpenBao Path | Required Keys |
|----------------|--------------|---------------|
| `drawrace-api-s3-credentials` | `secret/data/rs-manager/drawrace/s3` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL`, `AWS_REGION` |
| `drawrace-postgres-backup-s3` | `secret/data/rs-manager/drawrace/postgres-backup` | `accessKeyId`, `secretAccessKey` |
| `drawrace-postgres-credentials` | `secret/data/rs-manager/drawrace/postgres` | `username`, `password` |

## Prerequisites Check

Before running the setup, ensure:
- ✅ Cluster admin access to iad-acb confirmed
- ❌ OpenBao root token obtained (**BLOCKER**)
- ✅ Working directory: `/home/coding/drawrace`
- ✅ Setup script exists: `scripts/setup-openbao-secrets.sh`
- ✅ Cluster namespace exists: `drawrace`

## Next Steps

1. **Contact cluster admin** to obtain OpenBao root token
2. **Set environment variable:** `export OPENBAO_TOKEN="<token>"`
3. **Run setup script:** `./scripts/setup-openbao-secrets.sh`
4. **Verify ExternalSecrets** show `SecretSynced` status
5. **Close task nd-t2fq** with confirmation of successful configuration

## Documentation References

- **Setup script:** `scripts/setup-openbao-secrets.sh`
- **Execution checklist:** `docs/openbao-secrets-execution-checklist.md`
- **Creation guide:** `docs/openbao-secrets-creation-guide.md`
- **Setup instructions:** `docs/setup-openbao-secrets.md`

---

**Status:** ⏳ **WAITING FOR OPENBAO TOKEN**  
**Last Updated:** 2026-08-10  
**Task ID:** nd-t2fq  
**Blocker:** OpenBao root token required from cluster admin