# Bead bf-5of5: Wire k6 Load + Chaos Tests into Nightly Mode

## Summary

This task to integrate k6 load tests and chaos tests into the drawrace-ci WorkflowTemplate nightly mode was already completed in commit `c9a7b984a8631aa4eff9beb75a4723a699911a95`.

## Work Done (c9a7b98)

The commit included:

1. **load-test template** - Runs `k6 run load/submit.js` against staging API
   - Uses `grafana/k6:latest` image
   - Ramp from 50→2000 RPS over several stages
   - Thresholds: <1% failure rate, p95<400ms, p99<1200ms

2. **chaos-test template** - Runs chaos test while killing an API pod
   - Uses `alpine/k8s-kubectl:v1.29.3` image
   - Installs k6, sets up kubeconfig for iad-acb kubectl-proxy
   - Runs `load/chaos-test.sh` which:
     - Starts k6 at 500 RPS
     - Kills one drawrace-api pod
     - Monitors API recovery
     - Verifies <0.5% error rate during chaos

3. **iad-acb-drawrace-chaos-sa.yaml** - ServiceAccount with RBAC permissions
   - Can list and delete drawrace-api pods
   - Used by chaos-test for pod kill during test

4. **Updated chaos-test.sh** - Graceful RBAC error handling
   - Falls back to load-only mode if kubectl lacks delete permissions
   - Better error messages for Forbidden/Unauthorized responses

## DAG Integration

Both tests are wired into the CI DAG with:
```yaml
- name: load
  template: load-test
  dependencies: [e2e]
  when: "'{{workflow.parameters.mode}}' == 'nightly'"

- name: chaos
  template: chaos-test
  dependencies: [e2e]
  when: "'{{workflow.parameters.mode}}' == 'nightly'"
```

## Verification

- load-test template runs `grafana/k6:latest` with `load/submit.js`
- chaos-test template installs k6 and runs `chaos-test.sh`
- Both properly set API=https://api.drawrace.ardenone.com and HMAC_KEY
- Both only execute when mode==nightly
- RBAC for pod deletion is defined in k8s/iad-acb-drawrace-chaos-sa.yaml

No additional changes needed.
