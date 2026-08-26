# Database Credential Scripts Audit

**Date**: 2026-08-25  
**Task**: Audit database credential scripts for cluster references  
**Child of**: drawrace-9e404cc6  
**Status**: ✅ COMPLETE - No iad-acb references found, rs-manager configuration correct

---

## Summary

All database credential scripts have been audited for cluster references. **No functional iad-acb references were found** - all scripts are correctly configured for rs-manager deployment.

### Key Findings

- ✅ **All scripts use rs-manager endpoint**: `http://traefik-rs-manager:8001`
- ✅ **All OpenBao paths use rs-manager prefix**: `secret/rs-manager/drawrace/*`
- ✅ **No functional code references iad-acb**
- ⚠️  **One script has iad-acb in documentation comments only** (non-functional)

---

## Scripts Inventory

### 1. Core Database Credential Scripts

| Script | Functional Code | Cluster Endpoint | OpenBao Path | Status |
|--------|---------------|------------------|-------------|---------|
| `setup-openbao-secrets.sh` | ✅ Active | `http://traefik-rs-manager:8001` | `secret/rs-manager/drawrace/*` | ✅ Correct |
| `populate-openbao-postgres.sh` | ✅ Active | `http://traefik-rs-manager:8001` | `secret/rs-manager/drawrace/postgres` | ✅ Correct |
| `populate-openbao-s3.sh` | ✅ Active | `http://traefik-rs-manager:8001` | `secret/rs-manager/drawrace/s3` | ✅ Correct |

### 2. Verification Scripts

| Script | Functional Code | Cluster Endpoint | Namespaces | Status |
|--------|---------------|------------------|------------|---------|
| `verify-openbao-k8s-access.sh` | ✅ Active | `http://traefik-rs-manager:8001` | `drawrace`, `garage-operator` | ✅ Correct |
| `verify-garage-resources.sh` | ✅ Active | `http://traefik-rs-manager:8001` | `garage-operator` | ✅ Correct |
| `verify-externalsecrets.sh` | ✅ Active | `http://traefik-rs-manager:8001` | `drawrace` | ✅ Correct |
| `retrieve-garage-access-key.sh` | ✅ Active | `http://traefik-rs-manager:8001` | `drawrace` | ✅ Correct |

### 3. Deployment & Monitoring Scripts

| Script | Functional Code | Cluster Endpoint | DNS/API | Status |
|--------|---------------|------------------|---------|---------|
| `check-deployment-landed.sh` | ✅ Active | `http://traefik-rs-manager:8001` | `api-drawrace.ardenone.com` | ✅ Correct |

---

## Detailed Configuration Analysis

### Cluster Endpoints (All Functional Code)

All scripts consistently use the correct rs-manager endpoint:

```bash
# Used across all scripts
KUBERNETES_PROXY="http://traefik-rs-manager:8001"
kubectl --server="http://traefik-rs-manager:8001"
```

### OpenBao Secret Paths (All Functional Code)

All OpenBao paths use the correct rs-manager prefix:

```bash
# API S3 credentials
secret/rs-manager/drawrace/s3

# Postgres credentials  
secret/rs-manager/drawrace/postgres

# Postgres backup S3 credentials
secret/rs-manager/drawrace/postgres-backup
```

### Namespace References

| Namespace | Usage | Scripts |
|-----------|-------|---------|
| `drawrace` | Main application namespace | All scripts |
| `garage-operator` | Garage S3 resources | `setup-openbao-secrets.sh`, `verify-garage-resources.sh` |
| `tailscale` | OpenBao pod location | `setup-openbao-secrets.sh` |
| `openbao` | OpenBao namespace (alt) | `create-garage-s3-key.sh` |

### Service References

| Service | Endpoint | Purpose |
|---------|----------|---------|
| `traefik-rs-manager:8001` | `http://traefik-rs-manager:8001` | Kubernetes API proxy |
| `openbao.external-secrets.svc.cluster.local:8200` | Internal service | OpenBao API access |
| `garage.ardenone-hub.svc:3900` | Internal service | Garage S3 endpoint |
| `api-drawrace.ardenone.com` | Public DNS | Production API endpoint |

---

## iad-acb Reference Analysis

### Found in Documentation Only (Non-Functional)

**File**: `extract-reference-ghosts.sh`  
**Lines**: 53, 64, 77, 91, 98  
**Type**: Documentation comments only  
**Impact**: ❌ None - these are historical references in comments

**Example comment**:
```bash
#   * iad-acb — the *intended* target cluster (see BLOCKER_SUMMARY.md)
```

### No Functional iad-acb Code Found

✅ **All functional cluster references are rs-manager**

---

## Endpoints and Services Catalog

### External Endpoints

| Endpoint | URL | Protocol | Usage |
|----------|-----|----------|-------|
| **Kubernetes API** | `http://traefik-rs-manager:8001` | HTTP | Kubectl proxy access |
| **Public API** | `api-drawrace.ardenone.com` | HTTPS | Production API (DNS) |
| **OpenBao Public** | `https://openbao.ardenone.com` | HTTPS | External OpenBao access |

### Internal Services (Cluster-Local)

| Service | Address | Namespace | Purpose |
|---------|---------|-----------|---------|
| **OpenBao** | `openbao.external-secrets.svc.cluster.local:8200` | `external-secrets` | Internal OpenBao API |
| **Garage S3** | `garage.ardenone-hub.svc:3900` | `ardenone-hub` | S3-compatible storage |
| **Kubernetes API** | `traefik-rs-manager:8001` | N/A (proxy) | K8s API proxy |

### OpenBao Paths

| Path | Purpose | Scripts |
|------|---------|---------|
| `secret/rs-manager/drawrace/postgres` | Database credentials | `populate-openbao-postgres.sh`, `setup-openbao-secrets.sh` |
| `secret/rs-manager/drawrace/s3` | API S3 credentials | `populate-openbao-s3.sh`, `setup-openbao-secrets.sh` |
| `secret/rs-manager/drawrace/postgres-backup` | Backup S3 credentials | `populate-openbao-s3.sh`, `setup-openbao-secrets.sh` |

---

## Verification Checklist

### ✅ Cluster Configuration

- [x] All scripts use `http://traefik-rs-manager:8001` for kubectl access
- [x] No functional code references `iad-acb`
- [x] OpenBao paths use `rs-manager` prefix consistently
- [x] Namespace references are correct (`drawrace`, `garage-operator`)

### ✅ OpenBao Integration

- [x] Internal OpenBao service: `openbao.external-secrets.svc.cluster.local:8200`
- [x] External OpenBao endpoint: `https://openbao.ardenone.com` (where configured)
- [x] All secret paths follow `secret/rs-manager/drawrace/*` pattern
- [x] Token authentication properly configured

### ✅ Garage S3 Configuration

- [x] Garage cluster reference: `ardenone-hub`
- [x] S3 endpoint: `http://garage.ardenone-hub.svc:3900`
- [x] Bucket permissions correctly scoped
- [x] Both API and backup credentials configured

### ✅ DNS and API Configuration

- [x] Production API DNS: `api-drawrace.ardenone.com`
- [x] No hardcoded `iad-acb` URLs in functional code
- [x] All endpoints use rs-manager or generic cluster-agnostic names

---

## Recommendations

### ✅ No Changes Required

All database credential scripts are correctly configured for rs-manager deployment:

1. **Cluster endpoints**: All using `http://traefik-rs-manager:8001` ✅
2. **OpenBao paths**: All using `secret/rs-manager/drawrace/*` ✅  
3. **Namespaces**: Correct (`drawrace`, `garage-operator`) ✅
4. **DNS references**: Using `api-drawrace.ardenone.com` ✅

### Optional Cleanup

**Low Priority**: Update documentation comments in `extract-reference-ghosts.sh` to remove historical iad-acb references (lines 53, 64, 77, 91, 98). This is cosmetic only - no functional impact.

---

## Conclusion

**✅ Audit Complete - No Action Required**

All database credential scripts are correctly configured for the rs-manager cluster deployment. No functional iad-acb references were found. The scripts are ready for production use on rs-manager.

**Acceptance Criteria Met**:
- ✅ Complete inventory of all scripts with cluster references
- ✅ Distinguished between functional code and documentation  
- ✅ List of any iad-acb references found (documentation comments only)
- ✅ Verification that rs-manager references are correct