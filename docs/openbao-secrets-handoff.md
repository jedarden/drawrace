# OpenBao Secrets & Cluster Admin Access — Handoff

## Status: BLOCKED, awaiting infrastructure team action

**Bead:** nd-1fkb  
**Date:** 2026-07-02  
**Requested by:** DrawRace backend implementation

---

## What's Needed

### 1. OpenBao Root Token

**Purpose:** Write secrets via OpenBao API (DrawRace backend needs to store Postgres credentials, S3 credentials, etc.)

**Action required from infrastructure team:**
- Generate and provide an OpenBao root token (or grant permission to create one)
- Token should be exported as `OPENBAO_TOKEN` environment variable in drawrace deployment

**Verification:**
```bash
export OPENBAO_TOKEN=<token>
# Test token access
curl -s -H "X-Vault-Token: $OPENBAO_TOKEN" \
  https://openbao.ardenone.com:8200/v1/sys/health | jq .
```

### 2. Cluster Admin Permissions on iad-acb

**Purpose:** Create GarageBucket and GarageKey resources in garage-operator namespace

**Action required from infrastructure team:**
- Grant cluster-admin role or namespace-specific RBAC for creating garage-operator resources
- User/service account needs permissions on:
  - `garagebuckets.*` (garage-operator group)
  - `garagekeys.*` (garage-operator group)
  - Namespace: `garage-operator` (or appropriate target namespace)

**Verification:**
```bash
# Test auth can-i
kubectl auth can-i create garagebucket -n garage-operator
kubectl auth can-i create garagekey -n garage-operator
```

---

## Context from DrawRace Implementation

The DrawRace backend (Phase 2: Backend & Multiplayer) needs:

1. **OpenBao integration** for secrets management:
   - Postgres superuser password
   - Garage S3 credentials
   - Cloudflare Pages API token
   
2. **Garage S3 buckets** for ghost blob storage:
   - Create `drawrace-ghosts` bucket
   - Create corresponding `GarageKey` for S3 client access

These are blocking all backend deployment work. The manifests in `jedarden/declarative-config/k8s/iad-acb/drawrace/` reference these resources.

---

## Related Documentation

**Primary request document:**
- **`docs/infrastructure-permissions-request.md`** — Comprehensive permissions request with full context, blocker status, and readiness checklist

**Supporting documentation:**
- **`docs/openbao-secrets-creation-guide.md`** — Step-by-step OpenBao secrets setup guide
- **`docs/openbao-secrets-execution-checklist.md`** — Execution checklist for the setup process
- **`docs/openbao-secrets.md`** — OpenBao secret path mapping and structure
- **`docs/openbao-secrets-task-handoff.md`** — Detailed task handoff documentation
- **`scripts/setup-openbao-secrets.sh`** — Automated setup script (ready to run)

**Architecture context:**
- **`docs/plan/plan.md`** §Multiplayer & Backend Architecture — Backend architecture and storage design

---

## Next Steps (Once Access is Granted)

1. Export OPENBAO_TOKEN in deployment context
2. Create GarageBucket and GarageKey resources
3. Write DrawRace secrets to OpenBao using documented paths
4. Proceed with backend deployment (Phase 2)

---

## Contact

**Repository:** jedarden/drawrace  
**Cluster:** iad-acb (Rackspace Spot)  
**Namespace:** drawrace (to be created)

Please notify when credentials/permissions are available so this bead can be closed and backend work can proceed.
