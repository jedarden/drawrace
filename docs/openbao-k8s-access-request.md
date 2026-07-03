# OpenBao & Kubernetes Access Request for DrawRace

**Task:** nd-1fkb  
**Date:** 2026-07-03  
**Status:** 🟡 Awaiting Infrastructure Team Approval  
**Priority:** 🔴 **BLOCKER** - Required for all DrawRace backend work

---

## Executive Summary

DrawRace backend deployment requires two critical infrastructure permissions:

1. **OpenBao root token** - For storing secrets (S3 credentials, Postgres passwords)
2. **Cluster admin access on `iad-acb`** - For creating Garage S3 buckets/keys via garage-operator

**Both permissions are blockers** for Phase 2 (Backend & Multiplayer) deployment. Without them:
- ❌ Cannot create S3 buckets for ghost blob storage
- ❌ Cannot generate S3 access keys
- ❌ Cannot store Postgres database credentials securely
- ❌ Cannot deploy `drawrace-api` or `drawrace-validator` pods

---

## Access Requirements

### 1. OpenBao Root Token

**Purpose:** Store and retrieve secrets via OpenBao API

**Required Permissions:**
- ✅ Read secrets from `secret/data/rs-manager/drawrace/*`
- ✅ Write secrets to `secret/data/rs-manager/drawrace/*`
- ✅ Delete secrets from `secret/data/rs-manager/drawrace/*`

**Secret Paths to Create:**
```
secret/data/rs-manager/drawrace/s3              # API S3 credentials
secret/data/rs-manager/drawrace/postgres-backup  # Postgres backup S3 credentials  
secret/data/rs-manager/drawrace/postgres         # Postgres database credentials
```

**Why Root Token?**
- DrawRace setup script needs to create new secret paths
- ExternalSecret operator will read these paths with limited service account permissions
- Token is only used during initial setup, then rotated

---

### 2. Cluster Admin on iad-acb

**Purpose:** Create GarageBucket and GarageKey resources in garage-operator namespace

**Required Kubernetes Permissions:**
- ✅ `create` `garagebucket` `garage.rajsingh.info/v1beta0` in `garage-operator` namespace
- ✅ `get` `garagebucket` `garage.rajsingh.info/v1beta0` in `garage-operator` namespace
- ✅ `delete` `garagebucket` `garage.rajsingh.info/v1beta0` in `garage-operator` namespace
- ✅ `create` `garagekey` `garage.rajsingh.info/v1beta0` in `garage-operator` namespace
- ✅ `get` `garagekey` `garage.rajsingh.info/v1beta0` in `garage-operator` namespace
- ✅ `delete` `garagekey` `garage.rajsingh.info/v1beta0` in `garage-operator` namespace
- ✅ `create` `namespace` in cluster (for creating `drawrace` namespace)

**Resources to Create:**
```yaml
# GarageBucket for ghost blob storage
apiVersion: garage.rajsingh.info/v1beta0
kind: GarageBucket
metadata:
  name: drawrace-ghosts
  namespace: garage-operator

# GarageKey for API S3 access
apiVersion: garage.rajsingh.info/v1beta0
kind: GarageKey
metadata:
  name: drawrace-api-key
  namespace: garage-operator

# GarageKey for Postgres backup S3 access
apiVersion: garage.rajsingh.info/v1beta0
kind: GarageKey
metadata:
  name: drawrace-postgres-backup-key
  namespace: garage-operator
```

**Why Cluster Admin?**
- Need ability to create custom resources (GarageBucket/GarageKey) in garage-operator namespace
- Need to create drawrace namespace
- No existing role-based access control (RBAC) covers these specific permissions

---

## Access Delivery Method

### For Infrastructure Team

**Option 1: Provide Direct Access**

1. **OpenBao Root Token:**
   ```bash
   # Generate a new root token (if you have admin access)
   vault token create -policy=drawrace-admin
   
   # OR provide an existing root token
   # Export securely (do NOT email or commit to git)
   export OPENBAO_TOKEN="<token>"
   ```

2. **Kubernetes Cluster Admin:**
   ```bash
   # Create a service account with cluster-admin
   kubectl --kubeconfig=<admin-config> create serviceaccount drawrace-admin -n drawrace
   
   # Create cluster role binding
   kubectl --kubeconfig=<admin-config> create clusterrolebinding drawrace-admin \
     --clusterrole=cluster-admin \
     --serviceaccount=drawrace:drawrace-admin
   
   # Generate kubeconfig for the service account
   # See: https://kubernetes.io/docs/tasks/administer-cluster/access-control-cluster-administration/
   ```

**Option 2: Perform Setup on Behalf of DrawRace Team**

If you prefer not to grant direct access, you can run the setup script:

```bash
# Clone DrawRace repo
git clone https://git.ardenone.com/jedarden/drawrace.git
cd drawrace

# Run the setup script with your admin credentials
export OPENBAO_TOKEN="<your-admin-token>"
export KUBECONFIG="<path-to-iad-acb-admin-kubeconfig>"
./scripts/setup-openbao-secrets.sh
```

This script will:
- Create all required OpenBao secrets
- Create all required Garage resources
- Generate and store credentials
- Verify ExternalSecret sync

**Option 3: Hybrid Approach**

1. **You provide:** OpenBao root token (one-time use)
2. **You run:** K8s resource creation (GarageBucket/GarageKey) and provide the generated secrets
3. **DrawRace team:** Uses provided OpenBao token to store the secrets you generated

---

## Verification Steps

### After Access is Granted

**Step 1: Export Credentials**
```bash
export OPENBAO_TOKEN="<provided-token>"
export KUBECONFIG="<path-to-iad-acb-kubeconfig>"
```

**Step 2: Run Verification Script**
```bash
cd /home/coding/drawrace
./scripts/verify-openbao-k8s-access.sh
```

**Expected Output:**
```
=====================================
OpenBao & K8s Access Verification
=====================================

1. Checking OPENBAO_TOKEN environment variable...
✓ OPENBAO_TOKEN is set
   Token length: 128 characters

2. Checking OpenBao endpoint configuration...
✓ OPENBAO_HOST configured: openbao.ardenone.com

3. Testing OpenBao API access...
✓ Can reach OpenBao API

4. Testing OpenBao write permissions...
✓ Can write secrets to OpenBao

5. Checking kubectl access to iad-acb...
✓ Can reach iad-acb cluster

6. Testing namespace creation permissions...
✓ Can create namespaces

7. Testing GarageBucket resource creation...
✓ Can create GarageBucket resources
✓ GarageBucket CRD is functional

8. Testing GarageKey resource creation...
✓ Can create GarageKey resources

9. Testing CloudNativePG permissions...
✓ Can create CloudNativePG clusters

10. Testing ArgoCD Application creation...
⚠ Cannot create ArgoCD Applications (may be created by infra team)

=====================================
Summary
=====================================
Passed: 9
Failed: 0

✓ All checks passed!
You have all required permissions to proceed with DrawRace deployment.
```

**Step 3: Run OpenBao-Specific Verification**
```bash
./scripts/verify-openbao.sh
```

**Expected Output:**
```
Testing OpenBao access at https://openbao.ardenone.com...
1. Checking token status...
✅ Token is valid
   Display name: root
   Policies: root
   TTL: 0h

2. Testing list access to /drawrace...
✅ Can list secrets (X keys in /drawrace)

3. Testing write access to /drawrace/...
✅ Can write secrets to /drawrace

4. Cleaning up test secret...

🎉 All OpenBao verification checks passed!

Token <token>... has:
  ✓ Valid authentication
  ✓ List access to /drawrace
  ✓ Write access to /drawrace
```

**Step 4: Run K8s Auth Verification**
```bash
./scripts/verify-k8s-auth.sh
```

**Expected Output:**
```
Testing Kubernetes access for DrawRace...
Using kubeconfig: /home/coding/.kube/iad-acb.kubeconfig

1. Testing basic cluster access...
✅ Connected to cluster: iad-acb

2. Testing namespace access...
   Current namespace: drawrace

3. Testing namespace creation (admin capability)...
✅ Can create namespaces (cluster-admin capability)

4. Testing GarageBucket creation in garage-operator namespace...
   Namespace 'garage-operator' exists

5. Checking GarageBucket resource permissions...
✅ Can create GarageBucket in garage-operator
✅ Can get GarageBucket in garage-operator
✅ Can delete GarageBucket in garage-operator

6. Checking GarageKey resource permissions...
✅ Can create GarageKey in garage-operator
✅ Can get GarageKey in garage-operator
✅ Can delete GarageKey in garage-operator

7. Testing DrawRace namespace creation...
✅ Can create drawrace namespace

════════════════════════════════════════════════════════════
🎉 All Kubernetes permission checks passed!

Cluster access verified for:
  ✓ Create/get/delete GarageBucket in garage-operator
  ✓ Create/get/delete GarageKey in garage-operator
  ✓ Create drawrace namespace

Ready to deploy DrawRace infrastructure.
```

---

## What Happens After Access is Granted

### Automated Setup (Recommended)

Once access is verified, run the automated setup script:

```bash
cd /home/coding/drawrace
export OPENBAO_TOKEN="<your-token>"
./scripts/setup-openbao-secrets.sh
```

This script will automatically:
1. Create `GarageBucket drawrace-ghosts` (50Gi quota, versioning enabled)
2. Create `GarageKey drawrace-api-key` for API S3 access
3. Create `GarageKey drawrace-postgres-backup-key` for backup S3 access
4. Extract S3 credentials from Garage-generated secrets
5. Generate secure Postgres credentials
6. Populate OpenBao with all required secrets
7. Verify ExternalSecrets sync successfully
8. Clean up temporary Garage secrets

### Manual Setup

If you prefer manual setup, see:
- `docs/openbao-secrets-creation-guide.md` - Comprehensive step-by-step guide
- `docs/openbao-secrets-execution-checklist.md` - Execution checklist

---

## Security Considerations

### OpenBao Root Token

**Risks:**
- Root token has unrestricted access to all OpenBao secrets
- Can create, read, update, delete any secret
- Can manage OpenBao policies and tokens

**Mitigations:**
- ✅ Token is only used during initial setup
- ✅ Token is rotated after setup completion
- ✅ ExternalSecret operator uses limited service account with read-only access to specific paths
- ✅ DrawRace secrets are isolated under `rs-manager/drawrace/*` path
- ✅ Token is never stored in version control or application code

**Storage Recommendations:**
- Store in password manager (1Password, Bitwarden, etc.)
- Use environment variable only during setup session
- Clear from shell history after setup: `history -c`

### Kubernetes Cluster Admin

**Risks:**
- Cluster admin has unrestricted access to all cluster resources
- Can modify/delete any namespace, deployment, secret, etc.
- Can create cluster-wide resources (CRDs, cluster roles, etc.)

**Mitigations:**
- ✅ Access is only needed during initial infrastructure setup
- ✅ Create limited RBAC roles for ongoing operations after setup
- ✅ Use service accounts with minimal permissions for deployments
- ✅ Kubeconfig is stored securely and never committed to git

**Ongoing Permissions (Post-Setup):**
After initial setup, ongoing operations only require:
- `get`/`list`/`watch` pods in `drawrace` namespace
- `get`/`list` secrets in `drawrace` namespace
- `get`/`list` deployments in `drawrace` namespace

No ongoing cluster-admin access is required for normal operations.

---

## RBAC Recommendation (Post-Setup)

Once initial setup is complete, create limited RBAC for ongoing operations:

```yaml
# drawrace-role.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: drawrace
  name: drawrace-operator
rules:
- apiGroups: [""]
  resources: ["pods", "secrets", "configmaps", "services"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["apps"]
  resources: ["deployments", "statefulsets"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["batch"]
  resources: ["jobs", "cronjobs"]
  verbs: ["get", "list", "watch"]

---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  namespace: drawrace
  name: drawrace-operator-binding
subjects:
- kind: ServiceAccount
  name: drawrace-operator
  namespace: drawrace
roleRef:
  kind: Role
  name: drawrace-operator
  apiGroup: rbac.authorization.k8s.io
```

This limited role is sufficient for:
- ArgoCD sync operations
- Monitoring and observability
- Log collection
- Debugging and troubleshooting

---

## Emergency Access Recovery

If OpenBao root token is lost or compromised:

### Recovery Steps

1. **Contact Infrastructure Team**
   - Request token revocation for compromised token
   - Request generation of new root token

2. **Rotate Compromised Token**
   ```bash
   # Infrastructure team action (requires admin access)
   vault token revoke <compromised-token>
   vault token create -policy=drawrace-admin -display-name="drawrace-setup-recovery"
   ```

3. **Update Environment Variable**
   ```bash
   export OPENBAO_TOKEN="<new-token>"
   ```

4. **Re-run Setup Script**
   ```bash
   ./scripts/setup-openbao-secrets.sh
   ```

5. **Verify Recovery**
   ```bash
   ./scripts/verify-openbao.sh
   kubectl --server=http://traefik-iad-acb:8001 get externalsecrets -n drawrace
   ```

### Token Rotation Schedule

**Recommended:**
- Initial root token: Rotate within 24 hours after setup completion
- Setup tokens: Rotate quarterly (every 3 months)
- Emergency rotation: Immediately upon compromise discovery

---

## Contact Information

### Infrastructure Team

**For Access Requests:**
- Email: infrastructure@ardenone.com
- Slack: #infrastructure-access
- Response time: 1-2 business days

**For Emergency Issues:**
- Email: oncall@ardenone.com
- Slack: #infrastructure-oncall
- Response time: 1-2 hours

### DrawRace Team

**Technical Questions:**
- Email: jedarden@ardenone.com
- Slack: #drawrace
- Bead: nd-1fkb

---

## References

**Documentation:**
- OpenBao Secrets Overview: `docs/openbao-secrets.md`
- Secret Creation Guide: `docs/openbao-secrets-creation-guide.md`
- Execution Checklist: `docs/openbao-secrets-execution-checklist.md`
- Task Summary: `docs/openbao-secrets-task-summary.md`

**Scripts:**
- Setup Script: `scripts/setup-openbao-secrets.sh`
- Verification Script: `scripts/verify-openbao-k8s-access.sh`
- OpenBao Verification: `scripts/verify-openbao.sh`
- K8s Auth Verification: `scripts/verify-k8s-auth.sh`

**External Documentation:**
- OpenBao API: https://openbao.org/docs/
- Garage Operator: https://github.com/rajsingh/garage-operator
- Kubernetes RBAC: https://kubernetes.io/docs/reference/access-authn-authz/rbac/

---

## Appendix: Sample Access Request Email

**Subject:** DrawRace Backend Infrastructure Access Request

**To:** infrastructure@ardenone.com

**Body:**

Hello Infrastructure Team,

I'm requesting access to deploy the DrawRace backend on the iad-acb cluster. This access is required for Phase 2 (Backend & Multiplayer) deployment.

**What I Need:**

1. **OpenBao Root Token** - For storing S3 and Postgres credentials
   - Read/write access to: `secret/data/rs-manager/drawrace/*`
   - Token will be rotated after initial setup

2. **Cluster Admin on iad-acb** - For creating Garage S3 resources
   - Create GarageBucket/GarageKey in garage-operator namespace
   - Limited RBAC will be configured after setup

**What This Enables:**

- S3 buckets for ghost blob storage (Garage on ardenone-hub)
- Postgres database credentials (secure storage)
- Automated secret sync via ExternalSecret operator

**Security:**

- Token is used only for initial setup, then rotated
- Ongoing operations use limited RBAC (no cluster-admin)
- All credentials stored in OpenBao with access controls
- Full documentation: `/home/coding/drawrace/docs/openbao-k8s-access-request.md`

**Verification:**

Access will be verified using:
```bash
cd /home/coding/drawrace
./scripts/verify-openbao-k8s-access.sh
```

**Delivery Method:**

Please provide access via:
1. Direct delivery (preferred): Export OPENBAO_TOKEN and KUBECONFIG
2. Hybrid: You create Garage resources, I store them with provided token
3. Delegated: You run setup script with your credentials

Documentation for each method is in the access request doc linked above.

**Timeline:**

This is a blocker for Phase 2 backend deployment. Estimated setup time: 30 minutes.

**Questions:**

- Which delivery method works best for your team?
- Is there an existing approval process I should follow?
- Are there any additional security requirements?

Thank you for your help!

Best,
Jedarden

---

**Document Version:** 1.0  
**Last Updated:** 2026-07-03  
**Maintained By:** DrawRace Infrastructure Team  
**Related Beads:** nd-1fkb (access request), nd-2636 (OpenBao secrets creation)  
