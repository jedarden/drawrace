# OpenBao Quick Reference

**Task:** bf-33p57 - Verify OpenBao access and existing secret structure  
**Status:** ❌ BLOCKED - No OpenBao token available

## What I Found

### Connectivity
- ✅ OpenBao CLI installed at `/home/coding/.local/bin/openbao`
- ✅ `BAO_ADDR=https://openbao-rs-manager.ardenone.com` configured
- ❌ `OPENBAO_TOKEN` not set - **BLOCKER**

### Required Secrets (3 paths)

1. **`secret/data/rs-manager/drawrace/s3`** - API Garage S3 credentials
   - Keys: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL`, `AWS_REGION`

2. **`secret/data/rs-manager/drawrace/postgres-backup`** - Postgres backup S3 credentials  
   - Keys: `accessKeyId`, `secretAccessKey`

3. **`secret/data/rs-manager/drawrace/postgres`** - Database credentials
   - Keys: `username`, `password`

### Authentication Method
- OpenBao Root Token via `OPENBAO_TOKEN` environment variable
- Passed via `X-Vault-Token: $OPENBAO_TOKEN` HTTP header
- Required for all API operations

## Current State

**Cannot proceed without token.** When token is available:

```bash
export OPENBAO_TOKEN="<token>"
./scripts/verify-openbao.sh
```

This will:
1. Verify token is valid
2. List existing secrets under `rs-manager/drawrace/`
3. Check read/write access
4. Document what exists vs what needs creation

## Documentation Created

- `docs/openbao-access-verification.md` - Full verification report
- `docs/externalsecrets-audit-2026-08-10.md` - ExternalSecret status (already existed)
- `docs/openbao-quick-summary.md` - This file

## Next Action

**Contact cluster admin for OpenBao root token**, then run verification script.
