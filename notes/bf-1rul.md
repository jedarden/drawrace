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

## Verification
The ArgoCD Application should sync the manifests to rs-manager (iad-acb cluster).
Namespace `drawrace` will be created automatically on first sync.
