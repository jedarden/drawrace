# DrawRace Infrastructure Access Request

**Date:** 2026-07-03
**Project:** DrawRace - Mobile wheel-drawing racing PWA
**Cluster:** iad-acb (Rackspace Spot)
**Requested by:** jedarden

---

## Overview

DrawRace requires infrastructure access to deploy the backend services and manage secrets via OpenBao. This document outlines the access requirements and verification procedures.

---

## Access Requirements

### 1. OpenBao Root Token

**Purpose:** Write secrets to OpenBao for the DrawRace backend services

**Required Permissions:**
- Root token or token with ability to create child tokens
- Write access to KV secrets engine
- Create/update secrets at `drawrace/*` path

**Use Cases:**
- Store Postgres connection credentials
- Store Garage S3 credentials
- Store Cloudflare API token
- Store HMAC signing keys

**Security Note:** The OpenBao token will be:
1. Stored as Kubernetes SealedSecrets in the declarative-config repo
2. Never committed in plaintext to git
3. Injected into pods via environment variables or volume mounts

---

### 2. Kubernetes Cluster Admin on iad-acb

**Purpose:** Deploy and manage DrawRace resources on the cluster

**Required Permissions:**
- Cluster admin or equivalent namespace admin on `drawrace` namespace
- Create GarageBucket resources in `garage-operator` namespace
- Create GarageKey resources in `garage-operator` namespace
- Full RBAC on custom resources (Deployments, Services, Ingress, etc.)

**Use Cases:**
- Deploy drawrace-api and drawrace-validator pods
- Create Garage S3 buckets for ghost blob storage
- Manage secrets via SealedSecrets
- Configure Traefik ingress routes

---

## Deployment Architecture

```
iad-acb Cluster (Rackspace Spot)
├── Namespaces
│   ├── drawrace (main application)
│   │   ├── drawrace-api (axum HTTP server)
│   │   ├── drawrace-validator (ghost replay validator)
│   │   ├── postgres (CloudNativePG)
│   │   └── redis (ephemeral cache)
│   │
│   └── garage-operator (S3 storage)
│       ├── GarageBucket (drawrace-ghosts)
│       └── GarageKey (credentials)
│
└── Ingress
    └── api-drawrace.ardenone.com (Traefik + cert-manager)
```

---

## Verification Procedures

### After Receiving OpenBao Token

1. Export the token:
   ```bash
   export OPENBAO_TOKEN=<received-token>
   export OPENBAO_ADDR=http://openbao.<namespace>.svc.cluster.local:8200
   ```

2. Run verification script:
   ```bash
   ./scripts/verify-openbao-access.sh
   ```

3. Expected output:
   - ✅ Successfully connected to OpenBao
   - ✅ Token is valid with policies
   - ✅ Successfully wrote test secret
   - ✅ Successfully read back test secret

### After Receiving K8s Cluster Admin

1. Set kubectl context:
   ```bash
   kubectl config use-context <iad-acb-context>
   ```

2. Run verification script:
   ```bash
   ./scripts/verify-k8s-garage-access.sh
   ```

3. Expected output:
   - ✅ Successfully connected to cluster
   - ✅ Namespace garage-operator exists
   - ✅ Can create GarageBucket resources
   - ✅ Can create GarageKey resources

---

## Example ClusterRole for Garage Access

If you need to create a custom role for DrawRace, here's a template:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: drawrace-garage-admin
rules:
- apiGroups: ["garage-operator.dowel.ai"]
  resources: ["garagebuckets", "garagekeys"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]

---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: drawrace-garage-admin-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: drawrace-garage-admin
subjects:
- kind: User
  name: <your-username>
```

---

## Next Steps

### For Infrastructure Team

1. **Grant OpenBao Access:**
   - Generate a root token or create a DrawRace-specific policy
   - Share token securely via encrypted channel
   - Document token rotation procedure

2. **Grant K8s Cluster Admin:**
   - Create ClusterRoleBinding for user `jedarden`
   - Alternatively, create namespace admin role for `drawrace` namespace
   - Verify garage-operator namespace exists

3. **Share Connection Details:**
   - OpenBao endpoint URL
   - iad-acb cluster context name for kubeconfig
   - Any proxy or VPN requirements

### For DrawRace Team

1. After access is granted:
   - Run verification scripts
   - Test secret creation in OpenBao
   - Test GarageBucket/GarageKey creation
   - Update CI/CD secrets in declarative-config repo

2. Deploy infrastructure:
   ```bash
   # Apply manifests
   kubectl apply -f k8s/iad-acb/drawrace/
   
   # Verify pods
   kubectl get pods -n drawrace
   
   # Check Garage resources
   kubectl get garagebucket,garagekey -n garage-operator
   ```

---

## Contact

**Infrastructure Team Contact:** [To be filled]
**Drawrace Maintainer:** jedarden
**Repository:** https://github.com/jedarden/drawrace
**Declarative Config:** https://github.com/jedarden/declarative-config

---

## Appendix: Verification Test Results

*This section will be updated once access is granted*

**OpenBao Access:** [Pending]
**K8s Cluster Admin:** [Pending]
**Garage Resource Creation:** [Pending]
**Initial Deployment:** [Pending]
