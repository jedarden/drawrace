# DrawRace Manual CI Trigger Status - 2026-06-27

## Task Summary
Trigger manual drawrace-build CI and verify end-to-end after all upstream fixes land.

## Upstream Bead Status ✅

All required upstream beads are CLOSED:

- **bf-32pmt** (clippy fixes) - COMPLETED (P0)
- **bf-2mmxk** (rotate-client-key: fix ImagePullBackOff) - CLOSED (P0)

## Local Code State ✅

- `pnpm lint` - PASSING
- `cargo test -p drawrace-validator` - PASSING (66 tests)
- `cargo clippy -p drawrace-validator -- -D warnings` - PASSING
- `cargo clippy -p drawrace-api -- -D warnings` - PASSING

## Infrastructure State ❌

### Missing drawrace Namespace

The `drawrace` namespace does NOT exist on checked clusters:
- ❌ ardenone-manager (kubectl proxy)
- ❌ rs-manager (no kubeconfig)
- ❌ iad-acb (connection issues via Traefik proxy)
- ❌ iad-ci (CI cluster only)

### CSI Issues on iad-ci

Recent workflow attempts fail with Rackspace Spot CSI rate limiting:
```
FailedAttachVolume: AttachVolume.Attach failed for volume "pvc-..."
Error: 413 OverLimit Retry... from CSI proxy
Volume stuck in "attaching" state
```

This affects the `git-checkout` step which uses a `volumeClaimTemplate` for workspace PVC.

## Workflow Template Status ✅

- `drawrace-build` WorkflowTemplate exists on iad-ci
- Template includes rotate-client-key with alpine:3.19 (bf-2mmxk fix)

## Blockers Summary

### Critical Blockers

1. **Infrastructure Not Deployed**: No `drawrace` namespace exists on target clusters
   - Need to apply manifests from `jedarden/declarative-config`
   - Should be on iad-acb per plan.md §Multiplayer & Backend 10

2. **CSI Rate Limiting**: iad-ci workflows fail with 413 OverLimit errors
   - Transient issue or cluster capacity problem
   - Need to investigate Rackspace Spot CSI proxy rate limits

### Verification Blockers

Without infrastructure deployed, cannot verify acceptance criteria:
- ❌ drawrace pods on iad-acb pulling new images
- ❌ ArgoCD syncing manifests
- ❌ End-to-end production rollout

## Recommended Next Steps

1. **Deploy Infrastructure** (P0):
   ```bash
   # Apply drawrace manifests to iad-acb
   kubectl --kubeconfig=~/kubeconfig-for-iad-acb apply -f \
     <(kubectl-cnpg -n drawrace -f jedarden/declarative-config/k8s/iad-acb/drawrace/)
   ```

2. **Fix CSI Issues** (P0):
   - Check Rackspace Spot CSI proxy rate limits
   - Consider adding retry/backoff to volume attachment
   - May need to file infrastructure ticket

3. **Retry Manual CI** (P1):
   Once infrastructure is deployed and CSI is stable:
   ```bash
   kubectl --kubeconfig=/home/coding/.kube/iad-ci.kubeconfig create -f - <<EOF
   apiVersion: argoproj.io/v1alpha1
   kind: Workflow
   metadata:
     generateName: drawrace-build-manual-
     namespace: argo-workflows
   spec:
     workflowTemplateRef:
       name: drawrace-build
     arguments:
       parameters:
         - name: branch
           value: main
   EOF
   ```

4. **Verify Images** (P1):
   ```bash
   # Check if images were pushed
   docker pull ronaldraygun/drawrace-api:latest
   docker pull ronaldraygun/drawrace-validator:latest
   ```

## Conclusion

**BLOCKED**: Cannot complete full end-to-end verification because:
1. drawrace infrastructure (namespace, deployments) not yet deployed to production cluster
2. Rackspace Spot CSI experiencing rate limiting issues preventing CI workflows from running

The upstream code is ready (lint, tests, clippy all passing), but infrastructure deployment is required before the acceptance criteria can be verified.

---

Generated: 2026-06-27
Task: bf-1fc6i - Trigger manual drawrace-build CI and verify end-to-end
