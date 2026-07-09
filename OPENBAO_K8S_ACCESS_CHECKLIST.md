# OpenBao and K8s Access Request for DrawRace Deployment

**Date:** 2026-07-03  
**Bead:** nd-1fkb  
**Cluster:** iad-acb (Rackspace Spot)  
**Namespace:** drawrace (to be created)

## Overview

This bead blocks all other DrawRace deployment work. We need:
1. **OpenBao root token** (or permission to create one) to write secrets via API
2. **Cluster admin permissions** on iad-acb to create GarageBucket/GarageKey CRDs

## Request 1: OpenBao Root Token

### What we need
- OpenBao root token (or a token with sufficient permissions to create/write secrets)
- Token should be exported as `OPENBAO_TOKEN` environment variable in CI/CD context

### What it's for
- Writing sealed-secrets for DrawRace deployment
- Storing sensitive config (Postgres credentials, S3 keys, Cloudflare tokens)
- Following the convention established in CLAUDE.md for secrets management

### Access level required
```
# Minimum needed permissions:
path "drawrace/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
path "drawrace/data/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
```

### Verification steps
Once token is obtained:
```bash
# 1. Export the token
export OPENBAO_TOKEN=<token>

# 2. Test access to OpenBao API
curl -s -H "X-Vault-Token: $OPENBAO_TOKEN" \
  https://<openbao-host>/v1/sys/health | jq .

# 3. Test write access
curl -X POST -H "X-Vault-Token: $OPENBAO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data":{"test":"value"}}' \
  https://<openbao-host>/v1/secret/data/drawrace/test
```

---

## Request 2: Cluster Admin on iad-acb

### What we need
- Cluster-admin role binding on iad-acb cluster
- Ability to create/modify:
  - Namespaces
  - Deployments, Services, Ingress
  - ConfigMaps, Secrets
  - **GarageBucket** and **GarageKey** CRDs (garage-operator resources)
  - CloudNativePG clusters
  - ArgoCD Applications

### What it's for
- Creating drawrace namespace and all resources within it
- Creating GarageBucket/GarageKey for ghost blob storage
- Managing Postgres via CloudNativePG
- Following GitOps convention (all changes via declarative-config, not direct kubectl)

### Verification steps
Once permissions are granted:
```bash
# 1. Check access to iad-acb cluster
kubectl --server=http://traefik-iad-acb:8001 auth can-i list namespaces

# 2. Test garage-operator resource creation (CRDs must be installed)
kubectl --server=http://traefik-iad-acb:8001 auth can-i create garagebucket -n garage-operator
kubectl --server=http://traefik-iad-acb:8001 auth can-i create garagekey -n garage-operator

# 3. Test creating a test GarageBucket (dry-run)
kubectl --server=http://traefik-iad-acb:8001 create garagebucket test-bucket \
  --dry-run=client -n drawrace

# Expected output: (no error if permissions are correct)
```

---

## Cluster Context

### iad-acb Cluster Details
- **Type:** Rackspace Spot workload cluster
- **Location:** us-east-iad-1
- **Management:** ArgoCD from rs-manager
- **Access:** kubectl-proxy over Tailscale (`http://traefik-iad-acb:8001`)
- **Existing operators:**
  - cert-manager (Let's Encrypt TLS)
  - garage-operator (S3-compatible storage)
  - CloudNativePG (Postgres)
  - ArgoCD (GitOps)

### Target Resources for DrawRace
```
drawrace/
├── Namespace
├── drawrace-api Deployment
├── drawrace-validator Deployment
├── Redis (ephemeral)
├── CloudNativePG Cluster (Postgres)
├── GarageBucket (ghost blob storage)
├── GarageKey (S3 credentials)
├── IngressRoute (Traefik)
├── Certificate (cert-manager)
└── SealedSecrets
```

---

## Questions for Infrastructure Team

1. **OpenBao:**
   - Is there an existing OpenBao instance for iad-acb?
   - What is the OpenBao endpoint URL?
   - Should we create a new drawrace policy, or use an existing one?
   - Who can approve/create the root token?

2. **K8s Permissions:**
   - Is iad-acb registered in ArgoCD on rs-manager already?
   - Are garage-operator CRDs installed cluster-wide, or namespace-scoped?
   - What is the process for granting cluster-admin? (RBAC creation, group membership, etc.)
   - Are there any naming conventions for namespaces/apps on iad-acb?

3. **GitOps Flow:**
   - Will declarative-config PRs be auto-synced by ArgoCD?
   - Is there a PR approval process for k8s/iad-acb/drawrace/ manifests?
   - Should we create the ArgoCD Application or will infra team create it?

---

## Next Steps (Once Access is Granted)

1. **Immediate:**
   - Export `OPENBAO_TOKEN` to environment (or add to CI secrets)
   - Verify kubectl access to iad-acb
   - Confirm garage-operator CRDs are present

2. **Create namespace and base resources:**
   ```bash
   kubectl create namespace drawrace
   kubectl apply -f k8s/iad-acb/drawrace/namespace.yaml
   ```

3. **Create Garage resources:**
   ```bash
   # GarageBucket for ghost storage
   kubectl apply -f k8s/iad-acb/drawrace/garage-bucket.yaml
   
   # GarageKey for S3 credentials
   kubectl apply -f k8s/iad-acb/drawrace/garage-key.yaml
   ```

4. **Write secrets to OpenBao:**
   ```bash
   # Postgres password
   vault kv put drawrace/postgres password=<postgres-pwd>
   
   # S3 credentials
   vault kv put drawrace/garage \
     access_key=<key> \
     secret_key=<secret>
   
   # Cloudflare token
   vault kv put drawrace/cloudflare token=<cf-token>
   ```

5. **Create sealed-secrets and sync via ArgoCD:**
   - All other resources follow standard GitOps flow
   - ArgoCD syncs from `jedarden/declarative-config/k8s/iad-acb/drawrace/`

---

## Blocking Status

**Current State:** ❌ BLOCKED - Waiting on credentials and permissions

**Unblocks:**
- All DrawRace backend deployment beads
- Garage S3 bucket creation
- Postgres cluster creation
- ArgoCD Application registration
- CI/CD pipeline (drawrace-build workflow)

**Estimated Time to Unblock:** 1-2 business days (pending infra team response)

---

## Contact

**Requested from:** Infrastructure team  
**Requester:** jedarden  
**Context:** DrawRace PWA backend deployment on iad-acb  
**Documentation:** See docs/plan/plan.md §Multiplayer & Backend Architecture
