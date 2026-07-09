# Bead nd-1fkb: BLOCKED - External Coordination Required

## Status: ❌ BLOCKED

This bead requires obtaining credentials and permissions from the infrastructure team. There is no code implementation required - this is purely an administrative coordination task.

---

## What's Already Set Up

✅ **Existing RBAC:** `drawrace-rotate-key` ServiceAccount with limited permissions (ConfigMap get/update/create only)  
✅ **Documentation:** Cross-cluster kubeconfig setup already documented in `k8s/iad-acb-kubeconfig-setup.md`

---

## What's Missing

❌ **OpenBao Root Token:** Not obtained yet  
❌ **Cluster Admin on iad-acb:** Not granted yet  
❌ **GarageBucket/GarageKey Creation Permissions:** Cannot verify without cluster admin

---

## Acceptance Criteria Status

| Criterion | Status | Evidence |
|-----------|--------|----------|
| OpenBao root token obtained and exported as OPENBAO_TOKEN | ❌ | No token received from infra team |
| Cluster admin permissions on iad-acb granted | ❌ | No cluster-admin RoleBinding created |
| Can create GarageBucket/GarageKey resources in garage-operator namespace | ❌ | Cannot test without permissions |

---

## What I've Done

✅ Created `OPENBAO_K8S_ACCESS_CHECKLIST.md` with:
- Detailed request for both OpenBao token and K8s permissions
- Verification commands to test access once granted
- Questions for the infrastructure team
- Context about the iad-acb cluster and required resources

✅ Reviewed existing infrastructure setup:
- Found existing RBAC for `drawrace-rotate-key` (limited scope)
- Confirmed kubeconfig setup process is documented
- Identified that garage-operator CRDs are referenced but permissions not verified

---

## Next Steps (Requires Infrastructure Team Action)

### For the Infrastructure Team:

1. **Provide OpenBao Access:**
   - Root token OR a token with `drawrace/*` path permissions
   - OpenBao endpoint URL
   - Confirmation of policy/permissions

2. **Grant K8s Cluster Admin on iad-acb:**
   - Create ClusterRoleBinding for cluster-admin
   - OR provide scoped permissions for:
     - Namespace creation
     - garage-operator resources (GarageBucket, GarageKey)
     - CloudNativePG, Deployments, Services, Ingress, etc.

### For Once Access is Granted:

```bash
# 1. Test OpenBao token
export OPENBAO_TOKEN=<provided-token>
curl -H "X-Vault-Token: $OPENBAO_TOKEN" \
  https://<openbao-endpoint>/v1/sys/health

# 2. Test K8s cluster admin
kubectl --server=http://traefik-iad-acb:8001 \
  auth can-i create garagebucket -n garage-operator

# 3. Create test GarageBucket (dry-run)
kubectl --server=http://traefik-iad-acb:8001 \
  create garagebucket test --dry-run=client -n drawrace

# 4. Proceed with remaining beads once both tests pass
```

---

## What Unblocks

Once this bead is closed, the following work can proceed:

- **Create Garage S3 bucket** for ghost blob storage
- **Set up Postgres** via CloudNativePG
- **Deploy drawrace-api and drawrace-validator**
- **Configure ArgoCD Application** for iad-acb
- **Complete CI/CD pipeline** (drawrace-build workflow)

---

## Why This Bead Cannot Be Closed Yet

This bead is fundamentally about **obtaining external access**, not implementing code. The workflow is:

1. ✅ Document what's needed (DONE)
2. ⏳ **WAIT** for infrastructure team to provide credentials
3. ⏳ **VERIFY** credentials work
4. ✅ **THEN** close the bead

We are currently at step 2 (waiting). The bead should remain open until the infrastructure team responds with:

- The OpenBao token (or confirmation of policy creation)
- Confirmation that cluster-admin (or scoped permissions) are granted
- Verification that garage-operator CRDs are installed on iad-acb

---

## Estimated Time to Unblock

**1-2 business days** (pending infrastructure team response)

If you are the infrastructure team reviewer, please refer to `OPENBAO_K8S_ACCESS_CHECKLIST.md` for the full request details and verification steps.

---

## Contact

**Bead ID:** nd-1fkb  
**Requested from:** Infrastructure team  
**Date:** 2026-07-03  
**Context:** DrawRace backend deployment on iad-acb cluster
