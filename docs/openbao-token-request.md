# OpenBao Root Token Request for DrawRace Deployment

## Purpose

Request OpenBao root token to configure DrawRace ExternalSecrets that are currently blocking deployment.

## What is Needed

**OpenBao root token** to populate secrets at these paths:
- `secret/data/rs-manager/drawrace/s3` (API S3 credentials)
- `secret/data/rs-manager/drawrace/postgres-backup` (Postgres backup S3 credentials)
- `secret/data/rs-manager/drawrace/postgres` (Postgres database credentials)

## Why This Token is Needed

The ExternalSecret operator requires read access to OpenBao secrets to sync them to Kubernetes. The setup script needs to:
1. Create the secret paths in OpenBao KV store
2. Populate them with credentials (S3 keys, Postgres credentials)
3. Enable ExternalSecret operator to access these paths

## Security Considerations

- **Token is only used for setup:** The token is used by the setup script to create initial secrets
- **Token is not stored:** The token is used as an environment variable during setup only
- **Least privilege:** After setup, consider using OpenBao policies for the ExternalSecret operator instead of root token
- **Token rotation:** Root token should be rotated after initial setup

## How to Provide the Token

**Provide the token securely** through one of these methods:

1. **Direct message** through secure communication channel
2. **Password manager** shared entry
3. **Kubernetes secret** (if there's a secure way to access it)

Once received, the token will be:
- Exported as `OPENBAO_TOKEN` environment variable
- Used only by the setup script
- Not stored in any files or documentation
- Cleared from shell history after setup

## Setup Process

Once token is provided, the setup will take approximately 5-10 minutes:

```bash
# Set the token (provided securely)
export OPENBAO_TOKEN="<provided-token>"

# Run the automated setup script
cd /home/coding/drawrace
./scripts/setup-openbao-secrets.sh

# Verify ExternalSecrets are syncing
kubectl --server=http://traefik-iad-acb:8001 get externalsecrets -n drawrace
```

## What Gets Created

The setup process will create:

### OpenBao Secrets
- `secret/data/rs-manager/drawrace/s3` - Garage S3 credentials for API
- `secret/data/rs-manager/drawrace/postgres-backup` - S3 credentials for Postgres backups
- `secret/data/rs-manager/drawrace/postgres` - Postgres database credentials

### Kubernetes Secrets (synced by ExternalSecrets)
- `drawrace-api-s3-credentials` - 4 keys (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL, AWS_REGION)
- `drawrace-postgres-backup-s3` - 2 keys (accessKeyId, secretAccessKey)
- `drawrace-postgres-credentials` - 2 keys (username, password)

### Garage Resources
- `GarageBucket/drawrace-ghosts` - 50Gi quota, versioning enabled
- `GarageKey/drawrace-api-key` - S3 access key for API
- `GarageKey/drawrace-postgres-backup-key` - S3 access key for backups

## Verification

After setup, all 3 ExternalSecrets should show:
- **STATUS:** SecretSynced
- **READY:** True
- **LAST SYNC:** Recent timestamp

## Contact Information

**Requesting:** DrawRace deployment automation  
**Task ID:** nd-t2fq  
**Required by:** DrawRace ExternalSecret configuration  
**Timeline:** Token needed to complete deployment setup

---

**Security Note:** This token request is for initial setup only. Consider implementing OpenBao policies for ongoing ExternalSecret operator access instead of using root token for production operations.