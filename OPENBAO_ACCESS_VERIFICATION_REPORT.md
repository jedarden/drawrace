# OpenBao Access and Secret Structure Verification Report

**Task:** bf-33p57  
**Date:** 2026-08-10  
**Status:** ❌ **BLOCKED - Cannot verify without OpenBao token**

---

## Executive Summary

This task attempted to verify OpenBao connectivity from the lab box and document the existing secret structure for DrawRace. While the OpenBao CLI is installed and the endpoint is configured, **authentication is not possible** without an OpenBao root token, which is the primary blocker preventing completion of this verification task.

---

## Connectivity Status from Lab Box

### ✅ OpenBao CLI Installation
```bash
$ which bao
/home/coding/.nix-profile/bin/bao
```
**Status:** OpenBao CLI is installed and available in the Nix profile

### ✅ OpenBao Endpoint Configuration
```bash
$ echo $BAO_ADDR
https://openbao-rs-manager.ardenone.com
```
**Status:** OpenBao endpoint is correctly configured for external access via Tailscale

### ❌ Authentication Token Missing
```bash
$ echo $OPENBAO_TOKEN
[empty - no token set]
```
**Status:** **BLOCKER** - No OpenBao root token available for authentication

### ✅ Basic Endpoint Reachability
```bash
$ curl -s -o /dev/null -w "%{http_code}" https://openbao-rs-manager.ardenone.com
307
```
**Status:** Endpoint responds with 307 redirect to Google OAuth (expected authentication behavior)

---

## Required OpenBao Secret Paths

Based on the ExternalSecrets configuration analysis from the closed bead bf-57pf2, the following OpenBao secret paths are required for DrawRace:

### 1. API S3 Credentials
**OpenBao Path:** `secret/data/rs-manager/drawrace/s3`

**Purpose:** Garage S3 credentials for ghost blob storage

**Required Structure:**
```json
{
  "data": {
    "AWS_ACCESS_KEY_ID": "<Garage-generated-access-key>",
    "AWS_SECRET_ACCESS_KEY": "<Garage-generated-secret-key>",
    "AWS_ENDPOINT_URL": "http://garage-operator.garage-operator.svc.cluster.local",
    "AWS_REGION": "garage"
  }
}
```

**Target Kubernetes Secret:** `drawrace-api-s3-credentials`

**ExternalSecret:** `drawrace-api-s3-credentials`

---

### 2. Postgres Backup S3 Credentials
**OpenBao Path:** `secret/data/rs-manager/drawrace/postgres-backup`

**Purpose:** S3 credentials for Postgres backups to Garage

**Required Structure:**
```json
{
  "data": {
    "accessKeyId": "<Garage-generated-access-key>",
    "secretAccessKey": "<Garage-generated-secret-key>"
  }
}
```

**Target Kubernetes Secret:** `drawrace-postgres-backup-s3`

**ExternalSecret:** `drawrace-postgres-backup-s3`

**Note:** Uses different key naming convention (camelCase) compared to API S3 credentials

---

### 3. Postgres Database Credentials
**OpenBao Path:** `secret/data/rs-manager/drawrace/postgres`

**Purpose:** Postgres database credentials for drawrace-api

**Required Structure:**
```json
{
  "data": {
    "username": "drawrace",
    "password": "<secure-random-32-char-password>"
  }
}
```

**Target Kubernetes Secret:** `drawrace-postgres-credentials`

**ExternalSecret:** `drawrace-postgres-credentials`

**Password Generation:** `openssl rand -base64 32 | tr -d "=+/" | cut -c1-25`

---

## Authentication Method

### Required Authentication
**Method:** OpenBao Root Token via environment variable or HTTP header

**Setup:**
```bash
export OPENBAO_TOKEN="<root-token-here>"
```

**Token Usage:**
- Passed via `X-Vault-Token: $OPENBAO_TOKEN` HTTP header for API calls
- Used automatically by bao CLI when `OPENBAO_TOKEN` is set
- Required for all OpenBao operations (read, write, list, delete)

### Token Verification
Once token is obtained, verify with:
```bash
bao status
# OR
curl -s --request GET \
  "${BAO_ADDR}/v1/auth/token/lookup-self" \
  -H "X-Vault-Token: ${OPENBAO_TOKEN}"
```

**Expected Response:**
```json
{
  "data": {
    "display_name": "root",
    "policies": ["root"],
    "ttl": "0s"
  }
}
```

---

## Current Secret Status (Unknown)

### ❌ Cannot Verify Without Token

Without an OpenBao token, we cannot determine:
- **Which secrets currently exist** under `secret/data/rs-manager/drawrace/`
- **The structure of any existing secrets**
- **Whether any required secrets have already been created**
- **Whether secret paths match expected ExternalSecret configuration**

### ExternalSecret Status (from cluster access attempts)

The ExternalSecrets operator expects these paths to exist:

| ExternalSecret | OpenBao Path | Target Secret | Expected Status | Actual Status |
|---------------|-------------|---------------|-----------------|---------------|
| `drawrace-api-s3-credentials` | `secret/data/rs-manager/drawrace/s3` | `drawrace-api-s3-credentials` | ❌ Not Ready | Unknown |
| `drawrace-postgres-backup-s3` | `secret/data/rs-manager/drawrace/postgres-backup` | `drawrace-postgres-backup-s3` | ❌ Not Ready | Unknown |
| `drawrace-postgres-credentials` | `secret/data/rs-manager/drawrace/postgres` | `drawrace-postgres-credentials` | ❌ Not Ready | Unknown |

**Note:** Actual cluster status cannot be verified due to cluster connectivity issues documented in other blockers.

---

## Secret Discovery Process (Once Token Available)

Once an OpenBao token is obtained, the following commands should be executed:

### 1. Verify Authentication
```bash
export OPENBAO_TOKEN="<provided-token>"
bao status
```

### 2. List Existing Secrets
```bash
# List all secrets under rs-manager/drawrace/
bao kv list secret/data/rs-manager/drawrace
# OR via API
curl -s --request LIST \
  "${BAO_ADDR}/v1/secret/data/rs-manager/drawrace" \
  -H "X-Vault-Token: ${OPENBAO_TOKEN}"
```

### 3. Check Each Required Path
```bash
# Check API S3 credentials
bao kv get secret/data/rs-manager/drawrace/s3

# Check Postgres backup credentials  
bao kv get secret/data/rs-manager/drawrace/postgres-backup

# Check Postgres database credentials
bao kv get secret/data/rs-manager/drawrace/postgres
```

### 4. Document Existing vs Missing
For each secret that exists:
- Document the current structure and keys
- Compare against expected structure
- Note any discrepancies

For each secret that doesn't exist:
- Flag for creation in next task (bf-4d82r, bf-1hab8)

---

## Expected vs Actual Secret Paths

### Additional Secrets Referenced in Documentation

The OPENBAO_SETUP.md document references additional secret paths that may be for a different version or purpose:

| Path | Purpose | Status |
|------|---------|--------|
| `secret/drawrace/postgres` | Postgres superuser password | Unclear if still needed |
| `secret/drawrace/cloudflare` | Cloudflare API token | Unclear if still needed |
| `secret/drawrace/dockerhub` | Docker Hub credentials | Unclear if still needed |
| `secret/drawrace/restic` | Restic backup password | Unclear if still needed |

**Note:** These paths use the older `secret/drawrace/*` convention, while the ExternalSecrets use the newer `secret/data/rs-manager/drawrace/*` convention with the `data/` prefix and cluster namespace prefix.

---

## OpenBao ClusterSecretStore Configuration

Based on the ExternalSecrets audit, the OpenBao ClusterSecretStore should be configured as:

**Name:** `openbao`  
**Type:** ClusterSecretStore  
**Provider:** OpenBao  
**Address:** `https://openbao-rs-manager.ardenone.com`  
**Auth:** Token-based (likely using service account token from external-secrets operator)

**Refresh Interval:** 1 hour for all DrawRace ExternalSecrets

---

## Prerequisites for Completion

### ❌ Blocker
- **OpenBao Root Token** - Required to authenticate and perform any operations

### ✅ Completed  
- OpenBao CLI installed and configured
- OpenBao endpoint accessible (via Tailscale)
- Secret structure clearly documented
- Setup automation scripts available
- Documentation comprehensive

### ⚠️ Cluster Connectivity Issues
- Cluster proxy access showing timeouts
- May be separate infrastructure issue
- Does not prevent OpenBao access verification itself

---

## Next Steps (Once Token Available)

### Immediate Actions
1. **Obtain OpenBao Root Token** from cluster administrator
2. **Set environment variable:** `export OPENBAO_TOKEN="<token>"`
3. **Verify authentication:** `bao status`
4. **List existing secrets:** `bao kv list secret/data/rs-manager/drawrace`
5. **Document current state** of each required secret path
6. **Identify gaps** between existing and required secrets
7. **Create missing secrets** using `scripts/setup-openbao-secrets.sh`
8. **Verify ExternalSecrets sync** successfully

### Time Estimate
- **Verification and documentation:** 10-15 minutes
- **Secret creation (if needed):** 15-20 minutes
- **Total:** 25-35 minutes once token is available

---

## Verification Checklist

Once OpenBao token is obtained:

- [ ] Verify OpenBao connectivity with `bao status`
- [ ] List existing secrets under `secret/data/rs-manager/drawrace/`
- [ ] Check if `s3` secret exists and document structure
- [ ] Check if `postgres-backup` secret exists and document structure
- [ ] Check if `postgres` secret exists and document structure
- [ ] Compare existing structure against expected structure
- [ ] Identify which secrets need creation
- [ ] Run setup script for missing secrets
- [ ] Verify ExternalSecrets sync successfully
- [ ] Document final state in this report

---

## Conclusion

**STATUS:** ❌ **TASK BLOCKED - Cannot verify OpenBao access or secret structure without authentication token**

**What Was Accomplished:**
- ✅ Confirmed OpenBao CLI is installed and configured
- ✅ Verified OpenBao endpoint is reachable
- ✅ Documented expected secret structure for all 3 required paths
- ✅ Identified authentication method (root token)
- ✅ Created verification checklist for when token is available
- ✅ Documented next steps clearly

**What Cannot Be Completed Without Token:**
- ❌ Cannot authenticate to OpenBao
- ❌ Cannot list existing secrets
- ❌ Cannot verify which secrets exist vs need creation
- ❌ Cannot verify actual secret structure
- ❌ Cannot complete acceptance criteria 2-4

**Primary Blocker:**
- **Missing OpenBao root token** (documented in nd-1fkb)
- This is an external dependency requiring infrastructure team coordination

**Task Status:** **REMAINS OPEN** for automatic retry per task instructions
**Rationale:** Cannot complete task without external dependency (OpenBao token)

---

**Report Completed:** 2026-08-10  
**Task:** bf-33p57 (Verify OpenBao access and existing secret structure)  
**Dependency:** bf-57pf2 (closed)  
**Blocking Task:** nd-1fkb (OpenBao token and cluster admin permissions)  
**Estimated Time to Complete:** 25-35 minutes once OpenBao token is available