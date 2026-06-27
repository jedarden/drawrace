# iad-acb Node 2 CNI Investigation Summary

**Date:** 2026-06-27  
**Node:** `prod-instance-17825486055310528`  
**Issue:** CNI NetworkPluginNotReady blocking pod scheduling

## Root Cause

New node added 2026-06-27 04:29 UTC is stuck **NotReady** almost 4 hours later due to Calico CNI initialization failure.

### Technical Details

1. **Calico Pod Status:**
   - Pod: `calico-node-q7652` in namespace `calico-system`
   - Status: `Init:ImagePullBackOff`
   - Failing to pull: `docker.io/calico/cni:v3.28.2`
   - Duration: 3h54m of repeated pull failures

2. **Node Conditions:**
   ```
   NetworkReady=false
   reason=NetworkPluginNotReady
   message=Network plugin returns error: cni plugin not initialized
   ```

3. **Working Calico Configuration:**
   - The existing ready node correctly uses `IP_AUTODETECTION_METHOD: kubernetes-internal-ip`
   - **This is NOT the firstFound IP issue** mentioned in project_acb_calico_fix.md
   - This is a pure image pull failure

## Impact on DrawRace

Multiple DrawRace pods are blocked and unable to schedule:

- `drawrace-api-5bf979b966-4jzjz` - Pending for 6h7m
- `drawrace-postgres-796d5b6756-mcmqg` - Pending for 6h7m
- `redis-cdf8f694b-vzpt2` - Pending for 6h7m
- Additional pods stuck for 19 days (chronic capacity issue)

**Scheduler Message:**
```
0/2 nodes are available:
  1 Insufficient cpu (ready node is CPU-saturated)
  1 node(s) had untolerated taint {node.kubernetes.io/not-ready: }
```

## Acceptance Criteria Status

**Current:** NOT MET  
**Requirement:** `prod-instance-17825486055310528` shows Ready OR replacement node comes up Ready

## Recommended Action

**Delete the node via Rackspace Spot UI** and let the cluster autoscaler provision a fresh replacement.

**Rationale:**
- Node has been NotReady for >4h threshold
- Image pull failure cannot be resolved with read-only kubeconfig access
- Multiple DrawRace pods are blocked and impacting service availability
- Cluster autoscaler will provision a healthy replacement node automatically

## Investigation Commands Used

```bash
# Check node status
kubectl --kubeconfig=/home/coding/.kube/iad-acb-readonly.kubeconfig get nodes -o wide

# Check CNI pods
kubectl --kubeconfig=/home/coding/.kube/iad-acb-readonly.kubeconfig get pods -n kube-system

# Check failing Calico pod details
kubectl --kubeconfig=/home/coding/.kube/iad-acb-readonly.kubeconfig describe pod -n calico-system calico-node-q7652

# Check DrawRace pod status
kubectl --kubeconfig=/home/coding/.kube/iad-acb-readonly.kubeconfig get pods -n drawrace

# Check scheduling failures
kubectl --kubeconfig=/home/coding/.kube/iad-acb-readonly.kubeconfig describe pod -n drawrace drawrace-api-5bf979b966-4jzjz
```

## Next Steps

1. ✅ Investigation complete - root cause identified
2. ⏳ **AWAITING ACTION:** Delete node via Rackspace Spot UI
3. ⏳ Verify replacement node comes up Ready
4. ⏳ Verify DrawRace pods schedule successfully
5. ⏳ Close bead bf-531 when acceptance criteria met

---
**Investigated by:** Claude Code Agent  
**Bead ID:** bf-531
