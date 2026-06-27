# iad-acb Node 2 CNI Investigation

## Issue Summary

**Node:** `prod-instance-17825486055310528` (104.239.169.150)  
**Status:** NotReady for 4h30m (added 2026-06-27 04:29 UTC)  
**Blocking:** ALL drawrace pods from scheduling (Insufficient cpu on the single ready node)

## Root Cause

**Calico CNI pod `calico-node-q7652` is stuck in `Init:ImagePullBackOff`**  
- Failing init container: `install-cni`
- Image: `docker.io/calico/cni:v3.28.2`
- Error: `Back-off pulling image "docker.io/calico/cni:v3.28.2"`
- Retry attempts: 1181+ over 4h30m

## Investigation Findings

### What IS Working on the Node
The following pods are running successfully on the problematic node:
- `csi-cinder-nodeplugin-bs792` (3/3 Running)
- `rxt-kube-proxy-b2jqt` (1/1 Running)
- `vcp-proxy-r7k8p` (1/1 Running)
- `tigera-operator-799cb9d689-m82xz` (1/1 Running)

This indicates:
- General node connectivity is working
- Container runtime (containerd) is functional
- Image pulls work for other registries/images
- The issue is specific to Calico CNI image pulls

### Comparison with Working Node
**Working node:** `prod-instance-17767388520094079` (Ready, 67 days uptime)  
- Calico pod: `calico-node-kh25c` (1/1 Running)
- Successfully pulled images:
  - `docker.io/calico/pod2daemon-flexvol:v3.28.2` ✓
  - `docker.io/calico/cni:v3.28.2` ✓
  - `docker.io/calico/node:v3.28.2` ✓

## Possible Causes (Isolated)

1. **Docker Hub Rate Limiting** - The new node's IP might be hitting Docker Hub's rate limits differently than the established node
2. **Network Routing/Edge Case** - Specific connectivity issue to Docker Hub from the new node's IP
3. **Image Layer Caching** - The working node has cached layers; the new node doesn't

## Recommended Action

**The node has exceeded the 4h NotReady threshold.** Per the investigation plan:

> **Step 4:** If the node stays NotReady >4h: delete it via Rackspace Spot UI and let the cluster autoscaler provision a fresh one

**Current status:** 4h30m NotReady (exceeds threshold)

**Action required:** 
1. Access the Rackspace Spot UI for the iad-acb cluster
2. Delete node `prod-instance-17825486055310528`
3. Let the cluster autoscaler provision a fresh replacement node
4. Monitor that the new node comes up Ready with CNI initialized

## Acceptance Criteria

The task acceptance criteria states:
- `prod-instance-17825486055310528` shows Ready in `kubectl get nodes` **OR**
- A new replacement node comes up Ready

Since manual intervention via Rackspace Spot UI is required to delete the problematic node, the cluster autoscaler should then provision a fresh node that comes up Ready.

## Additional Notes

- This is not the `firstFound` IP issue mentioned in the Calico fix documentation (that pertains to Calico selecting unreachable IPs)
- The read-only kubeconfig limits troubleshooting - full access would allow checking kubelet logs and testing network connectivity
- The cluster has one healthy node (`prod-instance-17767388520094079`) carrying all load
- Drawrace pods are blocked due to CPU saturation on the single ready node

## Timeline

- 04:29 UTC - Node `prod-instance-17825486055310528` added to cluster
- 04:29 UTC - Calico pod created, ImagePullBackOff begins
- 08:59 UTC - Current time (4h30m of CNI failure)

## Next Steps

1. **Immediate:** Delete the problematic node via Rackspace Spot UI
2. **Monitor:** Watch for new node to join and become Ready
3. **Verify:** Check that drawrace pods can schedule once the new node is Ready
4. **Post-mortem:** Consider pre-pulling Calico images or using a private registry to avoid Docker Hub rate limiting issues in the future
