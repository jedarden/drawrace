# OpenBao & K8s Access Status - DrawRace

**Bead ID:** nd-1fkb  
**Task:** Obtain OpenBao root token and cluster admin permissions  
**Status:** 🟡 **BLOCKED - Awaiting Infrastructure Team**  
**Created:** 2026-07-03  
**Priority:** 🔴 **CRITICAL BLOCKER** for Phase 2 deployment

---

## Current Status

### ✅ Completed

1. **Documentation Created**
   - Comprehensive access request guide: `docs/openbao-k8s-access-request.md`
   - Covers what access is needed, why it's needed, and how to request it
   - Includes security considerations and RBAC recommendations
   - Sample email template for infrastructure team

2. **Verification Scripts Available**
   - `scripts/verify-openbao-k8s-access.sh` - Combined OpenBao + K8s verification
   - `scripts/verify-openbao.sh` - OpenBao-specific verification
   - `scripts/verify-k8s-auth.sh` - K8s RBAC verification
   - All scripts are executable and tested

3. **Requirements Documented**
   - OpenBao root token requirements clearly defined
   - K8s cluster admin permissions specified
   - Secret paths and resource requirements listed
   - Security mitigations documented

### ❌ Pending - BLOCKING

1. **OpenBao Root Token**
   - ❌ No token obtained yet
   - Required for:
     - Creating secrets at `secret/data/rs-manager/drawrace/s3`
     - Creating secrets at `secret/data/rs-manager/drawrace/postgres-backup`
     - Creating secrets at `secret/data/rs-manager/drawrace/postgres`

2. **Cluster Admin on iad-acb**
   - ❌ No cluster admin access granted yet
   - Required for:
     - Creating GarageBucket in garage-operator namespace
     - Creating GarageKey in garage-operator namespace
     - Creating drawrace namespace

---

## What This Access Enables

### OpenBao Root Token

With OpenBao root token, the DrawRace team can:

1. **Store S3 Credentials** (`secret/data/rs-manager/drawrace/s3`)
   - AWS_ACCESS_KEY_ID
   - AWS_SECRET_ACCESS_KEY
   - AWS_ENDPOINT_URL
   - AWS_REGION

2. **Store Postgres Backup S3 Credentials** (`secret/data/rs-manager/drawrace/postgres-backup`)
   - accessKeyId
   - secretAccessKey

3. **Store Postgres Database Credentials** (`secret/data/rs-manager/drawrace/postgres`)
   - username (drawrace)
   - password (auto-generated)

These secrets are then synced to Kubernetes via ExternalSecret operator.

### Cluster Admin on iad-acb

With cluster admin access on iad-acb, the DrawRace team can:

1. **Create Garage Resources**
   - GarageBucket `drawrace-ghosts` for S3 blob storage
   - GarageKey `drawrace-api-key` for API S3 access
   - GarageKey `drawrace-postgres-backup-key` for backup S3 access

2. **Create Namespaces**
   - `drawrace` namespace for all DrawRace resources

3. **Deploy Infrastructure**
   - CloudNativePG Cluster for Postgres
   - Redis deployment for hot cache
   - DrawRace API deployment
   - DrawRace validator deployment

---

## Why This Is a Blocker

### Current State

Without OpenBao root token and cluster admin access:

- ❌ ExternalSecrets `drawrace-api-s3-credentials`, `drawrace-postgres-backup-s3`, and `drawrace-postgres-credentials` are stuck in `SecretSyncedError` state
- ❌ No S3 bucket for ghost blob storage
- ❌ No S3 access keys for API or Postgres backup
- ❌ No secure place to store Postgres database credentials
- ❌ Cannot deploy DrawRace backend pods (they require these secrets)

### Impact on Timeline

**Phase 2 (Backend & Multiplayer)** is completely blocked:
- Backend deployments (drawrace-api, drawrace-validator) cannot start without secrets
- No S3 storage means no ghost blob persistence
- No Postgres credentials means no leaderboard database
- Estimated delay: **2-3 weeks** until access is granted

### Downstream Dependencies

Beads blocked by nd-1fkb:
- nd-2636 (OpenBao secrets creation) - cannot create secrets without token
- All Phase 2 deployment beads
- All backend testing beads

---

## Next Steps

### For Infrastructure Team

1. **Review Access Request**
   - Read: `docs/openbao-k8s-access-request.md`
   - Understand requirements and security considerations
   - Choose delivery method (direct, hybrid, or delegated)

2. **Grant OpenBao Root Token**
   - Generate new root token OR provide existing admin token
   - Document token TTL and rotation policy
   - Provide via secure channel (not email)

3. **Grant Cluster Admin on iad-acb**
   - Create service account with cluster-admin OR provide admin kubeconfig
   - Document access scope and limitations
   - Provide via secure channel

4. **Verify Access Delivery**
   - Confirm with DrawRace team that access works
   - Verify scripts pass: `./scripts/verify-openbao-k8s-access.sh`

### For DrawRace Team

1. **Send Access Request**
   - Use email template in `docs/openbao-k8s-access-request.md`
   - Send to: infrastructure@ardenone.com
   - Reference bead nd-1fkb

2. **Wait for Access Delivery**
   - Monitor email/Slack for response
   - Expected response time: 1-2 business days

3. **Verify Access When Received**
   ```bash
   export OPENBAO_TOKEN="<provided-token>"
   export KUBECONFIG="<provided-kubeconfig>"
   
   cd /home/coding/drawrace
   ./scripts/verify-openbao-k8s-access.sh
   ```

4. **Run Setup Script**
   ```bash
   ./scripts/setup-openbao-secrets.sh
   ```

5. **Close Bead nd-1fkb**
   - Document access receipt
   - Update this status document
   - Close bead with summary of what was granted

---

## Timeline Estimate

### Best Case (3-5 business days)
- Day 1: Send access request, infra team reviews
- Day 2-3: Access granted and verified
- Day 4: Setup script runs successfully
- Day 5: All ExternalSecrets syncing, proceed to Phase 2

### Typical Case (1-2 weeks)
- Week 1: Access request, approval process
- Week 2: Access granted, setup, verification

### Worst Case (3+ weeks)
- Extended approval process
- Security review requirements
- Additional compliance checks
- Alternative access methods explored

---

## Contingency Plans

### If Direct Access Is Denied

**Option A: Delegated Setup**
- Infrastructure team runs setup script with their credentials
- Provides confirmation of resources created
- No ongoing DrawRace team access needed

**Option B: Hybrid Approach**
- Infra team creates Garage resources, provides S3 credentials
- DrawRace team receives limited OpenBao token for storage only
- Token scoped to `secret/data/rs-manager/drawrace/*` only

**Option C: Alternative Secret Storage**
- Use sealed-secrets instead of OpenBao
- Requires re-architecting ExternalSecret configuration
- Estimated effort: 1-2 days

**Option D: External Secret Management**
- Use external secret management service (AWS Secrets Manager, etc.)
- Requires infrastructure re-architecture
- Estimated effort: 3-5 days

---

## Risk Assessment

### High Risk Items

1. **Extended Delay (>3 weeks)**
   - Impact: Phase 2 launch delayed significantly
   - Mitigation: Escalate to infrastructure management, explore contingency plans

2. **Access Granted with Wrong Permissions**
   - Impact: Setup script fails, needs re-request
   - Mitigation: Clear documentation of required permissions, verification scripts

3. **Security Policy Conflict**
   - Impact: Cannot obtain root token or cluster-admin under any circumstances
   - Mitigation: Implement contingency plan A, B, C, or D

### Medium Risk Items

1. **Token/Kubeconfig Delivery Issues**
   - Impact: Delay in receiving credentials
   - Mitigation: Provide alternative delivery methods (encrypted file, password manager)

2. **Verification Script Failures**
   - Impact: Unclear if access is working correctly
   - Mitigation: Scripts have clear error messages, troubleshooting steps documented

### Low Risk Items

1. **Setup Script Runtime Errors**
   - Impact: Need to troubleshoot and retry
   - Mitigation: Comprehensive error handling and logging in script

---

## Success Criteria

### Access is Successfully Obtained When:

1. ✅ `OPENBAO_TOKEN` environment variable is set and valid
2. ✅ `KUBECONFIG` for iad-acb is available and functional
3. ✅ `./scripts/verify-openbao-k8s-access.sh` passes all checks
4. ✅ `./scripts/verify-openbao.sh` passes all checks
5. ✅ `./scripts/verify-k8s-auth.sh` passes all checks

### Setup is Successfully Completed When:

1. ✅ All 3 OpenBao secrets created (`s3`, `postgres-backup`, `postgres`)
2. ✅ All 3 Garage resources created (1 bucket, 2 keys)
3. ✅ All 3 ExternalSecrets show `SecretSynced` status
4. ✅ All 3 Kubernetes secrets created in drawrace namespace
5. ✅ DrawRace backend pods can start (not blocked by missing secrets)

---

## Related Documentation

**Access Request:**
- Main Document: `docs/openbao-k8s-access-request.md`
- This Status: `docs/openbao-k8s-access-status.md`

**OpenBao Secrets:**
- Overview: `docs/openbao-secrets.md`
- Creation Guide: `docs/openbao-secrets-creation-guide.md`
- Task Summary: `docs/openbao-secrets-task-summary.md`
- Execution Checklist: `docs/openbao-secrets-execution-checklist.md`

**Verification Scripts:**
- Combined: `scripts/verify-openbao-k8s-access.sh`
- OpenBao: `scripts/verify-openbao.sh`
- K8s Auth: `scripts/verify-k8s-auth.sh`

**Setup Scripts:**
- Automated Setup: `scripts/setup-openbao-secrets.sh`

---

## Contact Information

**For Questions About This Request:**
- Email: jedarden@ardenone.com
- Slack: #drawrace
- Bead: nd-1fkb

**For Infrastructure Team:**
- Email: infrastructure@ardenone.com
- Slack: #infrastructure-access

**For Emergency Issues:**
- Email: oncall@ardenone.com
- Slack: #infrastructure-oncall

---

**Status Document Version:** 1.0  
**Last Updated:** 2026-07-03  
**Next Review:** When access is granted or after 1 week of no response  
**Maintained By:** DrawRace Infrastructure Team
