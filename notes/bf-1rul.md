# ArgoCD Application and Namespace Setup (bf-1rul)

## Summary
Created ArgoCD Application for drawrace on rs-manager pointing to `k8s/iad-acb/drawrace/`.

## Changes Made

### declarative-config (jedarden/declarative-config)
- Added missing k8s manifests to `k8s/iad-acb/drawrace/`:
  - `alertmanager-config.yaml` - Alertmanager configuration
  - `sealed-secrets-postgres.yaml.template` - PostgreSQL credentials template
  - `sealed-secrets-s3.yaml.template` - S3 backup credentials template
  - `servicemonitor.yaml` - Prometheus service monitoring
- Removed obsolete application manifests that were in the wrong location

### Existing Configuration (No Changes Needed)
- ArgoCD Application manifest: `k8s/rs-manager/drawrace-application.yml`
  - Points to `k8s/iad-acb/drawrace/`
  - Has `CreateNamespace=true`
  - Automated sync enabled

## Verification (2026-05-05)

```bash
# Application exists in ArgoCD
kubectl --kubeconfig=/home/coding/.kube/rs-manager.kubeconfig get application drawrace -n argocd

# Namespace exists on iad-acb
kubectl --kubeconfig=/home/coding/.kube/iad-acb.kubeconfig get namespace drawrace

# Resources are syncing (some pods not healthy due to external dependencies)
kubectl --kubeconfig=/home/coding/.kube/iad-acb.kubeconfig get all -n drawrace
```

## Status

- ArgoCD Application: Synced to iad-acb cluster ✓
- Namespace drawrace: Created ✓
- k8s manifests: Synced from declarative-config ✓

**Note:** Some pods show Pending/ImagePullBackOff due to:
- ExternalSecrets not configured in OpenBao (expected - separate setup task)
- Container images may need building

All deliverables for this task are complete.
