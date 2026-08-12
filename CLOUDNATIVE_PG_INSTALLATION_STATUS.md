# CloudNativePG Installation Status on rs-manager

**Date Checked:** 2026-08-12  
**Cluster:** rs-manager (Rackspace Spot, us-east-iad-1)  
**Access Method:** kubectl proxy via `http://traefik-rs-manager:8001`

## Findings: CloudNativePG is NOT installed

### CRDs Checked
- `clusters.postgresql.cnpg.io` - **NOT FOUND**
- `poolers.postgresql.cnpg.io` - **NOT FOUND**
- `backups.postgresql.cnpg.io` - **NOT FOUND**
- `schedules.postgresql.cnpg.io` - **NOT FOUND**
- Any CRDs matching `postgresql` or `cnpg` - **NOT FOUND**

### Namespace Status
- `cloudnative-pg` namespace - **DOES NOT EXIST** (returns `NotFound` error)

### Operator Pods
- No pods in `cloudnative-pg` namespace (namespace does not exist)
- No Deployments or StatefulSets matching `postgresql|cnpg|cloudnative` across all namespaces

## Conclusion

**CloudNativePG is NOT present on the rs-manager cluster.** This is the expected state before adding CloudNativePG to declarative-config. The cluster is ready for CloudNativePG installation as part of the DrawRace production backend deployment.

## Next Steps

Per the deployment plan, CloudNativePG will need to be installed on rs-manager before the DrawRace PostgreSQL cluster can be deployed. This involves:
1. Adding CloudNativePG operator manifests to declarative-config
2. Installing via ArgoCD from rs-manager
3. Creating the DrawRace Postgres Cluster manifest
4. Deploying the production backend
