# OpenBao Secrets Setup for DrawRace

This document describes how to configure OpenBao secrets for DrawRace ExternalSecrets.

## Overview

DrawRace requires 4 ExternalSecrets to be populated from OpenBao:
1. **Postgres superuser password** - For CloudNativePG cluster authentication
2. **Cloudflare API token** - For Cloudflare Pages deployment
3. **Docker Hub credentials** - For pulling container images
4. **Restic backup password** - For PostgreSQL backups to Garage S3

## Prerequisites

- OpenBao root token or appropriate policy token
- `bao` CLI installed and configured
- Access to the OpenBao instance

## OpenBao Paths

DrawRace uses the following OpenBao secret paths:

| Path | Purpose | Fields |
|------|---------|--------|
| `secret/drawrace/postgres` | Postgres superuser password | `password` |
| `secret/drawrace/cloudflare` | Cloudflare Pages deployment | `api-token`, `account-id` |
| `secret/drawrace/dockerhub` | Docker Hub image pull credentials | `username`, `password` |
| `secret/drawrace/restic` | Restic backup encryption | `restic-password` |

## Setup Procedure

### 1. Generate Strong Passwords

Generate cryptographically secure passwords for Postgres and Restic:

```bash
# Generate Postgres superuser password (save this securely!)
openssl rand -base64 32

# Generate Restic backup password (save this securely!)
openssl rand -base64 32
```

### 2. Create OpenBao Policy (if needed)

If you don't have a root token, create a policy for DrawRace:

```bash
bao policy write drawrace-policy - <<EOF
# Allow full access to DrawRace secrets
path "secret/data/drawrace/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
EOF
```

### 3. Populate OpenBao Secrets

Use the setup script or manually populate each secret:

```bash
# Postgres superuser password
bao kv put secret/drawrace/postgres \
  password="<generated-postgres-password>"

# Cloudflare API credentials
bao kv put secret/drawrace/cloudflare \
  api-token="<your-cloudflare-api-token>" \
  account-id="<your-cloudflare-account-id>"

# Docker Hub credentials
bao kv put secret/drawrace/dockerhub \
  username="jedarden" \
  password="<your-docker-hub-token>"

# Restic backup password
bao kv put secret/drawrace/restic \
  restic-password="<generated-restic-password>"
```

### 4. Verify Secrets are Set

```bash
# List all DrawRace secrets
bao kv list secret/drawrace

# Verify individual secrets
bao kv get secret/drawrace/postgres
bao kv get secret/drawrace/cloudflare
bao kv get secret/drawrace/dockerhub
bao kv get secret/drawrace/restic
```

## Cloudflare API Token Requirements

The Cloudflare API token needs the following permissions:
- **Account** - Cloudflare Pages:Edit
- **Zone** - (Optional) DNS:Edit if using custom DNS

To create the token:
1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token"
3. Use the "Edit Cloudflare Workers" template or create custom with:
   - Account > Cloudflare Pages > Edit
4. Copy the token (you won't see it again!)
5. Get your Account ID from the URL or dashboard overview

## Docker Hub Token Requirements

The Docker Hub access token needs:
- **Read:packages** scope for pulling images
- **Delete** scope (optional, for image management)

To create the token:
1. Go to https://hub.docker.com/settings/security
2. Click "New Access Token"
3. Give it a descriptive name (e.g., "drawrace-deployment")
4. Select "Read & Delete" or "Read Only" permissions
5. Copy the token immediately

## Verification

Once secrets are populated and ExternalSecrets are deployed:

```bash
# Check ExternalSecret status
kubectl --server=http://traefik-iad-acb:8001 get externalsecrets -n drawrace

# Check synced Secrets
kubectl --server=http://traefik-iad-acb:8001 get secrets -n drawrace

# Verify individual secret
kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-postgres -n drawrace -o yaml
```

Expected output:
- All ExternalSecrets should show `Ready: True`
- All Secrets should be present and contain the expected data

## Security Considerations

1. **Never commit secrets to git** - Use OpenBao or sealed-secrets only
2. **Rotate passwords regularly** - Update OpenBao and let ESO sync
3. **Use strong, unique passwords** - Generate with `openssl rand -base64 32`
4. **Limit token permissions** - Grant minimum required scope only
5. **Monitor access logs** - Review OpenBao audit logs periodically

## Troubleshooting

### ExternalSecret shows `Ready: False`

Check the ExternalSecret status for detailed error messages:
```bash
kubectl --server=http://traefik-iad-acb:8001 describe externalsecret <name> -n drawrace
```

Common issues:
- **OpenBao connectivity**: Check ClusterSecretStore configuration
- **Missing secret path**: Verify secret exists in OpenBao
- **Permission denied**: Check OpenBao policy/role bindings

### Secret not syncing

1. Check OpenBao secret exists: `bao kv get secret/drawrace/<name>`
2. Check ExternalSecret refresh interval (default: 1h)
3. Force sync by deleting the Secret: `kubectl delete secret <name> -n drawrace`

### Credential verification

Test credentials independently before adding to OpenBao:
```bash
# Test Docker Hub token
docker login -u jedarden --password-stdin < <(echo "<token>")

# Test Cloudflare token
curl -X GET "https://api.cloudflare.com/client/v4/user" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json"
```

## Related Documentation

- [BLOCKER_SUMMARY.md](BLOCKER_SUMMARY.md) - Overall deployment blockers
- [OPENBAO_K8S_ACCESS_CHECKLIST.md](OPENBAO_K8S_ACCESS_CHECKLIST.md) - K8s access requirements
- [DEPLOYMENT_VERIFICATION.md](DEPLOYMENT_VERIFICATION.md) - Post-deployment verification
- [docs/plan/plan.md](docs/plan/plan.md) - Full architecture documentation
