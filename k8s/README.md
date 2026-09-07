# DrawRace Kubernetes Manifests

## Where the cluster actually syncs from

Since 2026-09-07 the **deployed source of truth is a mirrored copy** in
`jedarden/declarative-config` at `k8s/rs-manager/drawrace/`, synced by the
ArgoCD Application `drawrace` on the **rs-manager** cluster (declared in
declarative-config at `k8s/rs-manager/drawrace-application.yml`, source
`github.com/jedarden/declarative-config` path `k8s/rs-manager/drawrace`).

Why: the rs-manager ArgoCD has no read credentials for this private Forgejo
repo (`git.ardenone.com/jedarden/drawrace`) — the app sat in
`ComparisonError: authentication required: Unauthorized` from 2026-09-04
until the source was retargeted to declarative-config, which the same
ArgoCD already authenticates (bead drawrace-7b173a87, remediation path B).

**Edit deployment manifests in declarative-config `k8s/rs-manager/drawrace/`.**
This directory is retained as the authoring history / CI-side reference and is
no longer wired to any cluster. If you change manifests here, mirror the change
across or the cluster will never see it.

## Image tags

Deployments pin semver tags from `containers/<name>/VERSION`
(currently `0.0.1` for api / validator / live). `:latest` is prohibited by
org policy. The `0.0.1` images have **not been built yet** — first build is a
known next blocker; when it happens, tag `0.0.1` (or bump VERSION and the
manifests together).

## Deliberately NOT in the rs-manager mirror

These files stay here only. rs-manager cannot host them — it runs no
Argo Workflows (no `argo-workflows` namespace, no WorkflowTemplate CRD), has
no Prometheus-operator CRDs, and its `garage-operator` namespace is stuck
`Terminating`:

| File | Missing dependency on rs-manager |
|---|---|
| `drawrace-build-workflowtemplate.yml` | WorkflowTemplate CRD / `argo-workflows` ns — CI runs on **iad-ci** (a copy already lives in declarative-config `k8s/iad-ci/argo-workflows/`) |
| `drawrace-ci-workflowtemplate.yml` | same — iad-ci only |
| `drawrace-submitter-rbac.yaml` | `argo-workflows` ns — iad-ci only |
| `pushgateway.yaml` | `argo-workflows` ns — iad-ci only |
| `servicemonitor.yaml` | `ServiceMonitor` CRD (`monitoring.coreos.com` absent) |
| `alertmanager-config.yaml` | `AlertmanagerConfig` CRD (absent) |
| `garage-resources.yaml` | `garage-operator` ns Terminating; Garage S3 reachability is a standing blocker |

Everything else in this directory is mirrored byte-for-byte into
declarative-config `k8s/rs-manager/drawrace/`.
