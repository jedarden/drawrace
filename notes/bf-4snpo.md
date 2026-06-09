# DrawRace/Quality Grafana Dashboard

## Task
Create a Grafana dashboard on ardenone-cluster with 8 metrics panels for DrawRace quality monitoring.

## Work Completed

### Dashboard Created
Created `/home/coding/declarative-config/k8s/ardenone-cluster/monitoring/grafana-dashboard-drawrace-quality.yml` with the following 8 panels:

1. **Submission Rate** - Timeseries showing `sum(rate(drawrace_validator_submissions_total[5m]))` submissions per second

2. **Re-sim Pass Rate** - Stat panel showing acceptance rate as `sum(rate(drawrace_validator_accepted_total[5m])) / sum(rate(drawrace_validator_submissions_total[5m]))` with thresholds at 90%/95%

3. **P95 Re-sim Tick Difference** - Stat panel showing proportion of submissions with >20 tick difference, used as a proxy for drift detection

4. **Ghost Pool Size** - Stat panel showing `drawrace_ghost_blob_bytes` total storage used

5. **Active Rooms** - Stat panel showing `drawrace_rooms_active` with thresholds at 400/500

6. **Physics Version Drift** - Timeseries showing replay mismatch rate with 0.5% and 1% threshold lines

7. **Error Rate by Type** - Timeseries and pie chart showing rejection reasons via `drawrace_validator_rejected_by_reason_total`

8. **CDN Cache Hit Rate (Proxy)** - Since direct CDN metrics aren't available, this panel shows HTTP error rates and ghost request patterns as a proxy

### Additional Panels
Added supplemental panels for completeness:
- Ghost Blob Growth Rate
- Lobby Size
- Live Service Availability
- HTTP 4xx/5xx Error Rates
- Tick Difference Distribution (bar gauge)
- Rejection Breakdown (pie chart)

### Deployment
- Dashboard configured as a ConfigMap with `grafana_dashboard: "1"` label for automatic discovery
- Committed and pushed to declarative-config repository
- ArgoCD will sync to ardenone-cluster monitoring namespace automatically

### Metrics Used
- `drawrace_validator_submissions_total`
- `drawrace_validator_accepted_total`
- `drawrace_validator_rejected_total`
- `drawrace_validator_resim_mismatch_total`
- `drawrace_validator_resim_tick_diff`
- `drawrace_validator_rejected_by_reason_total`
- `drawrace_ghost_blob_bytes`
- `drawrace_rooms_active`
- `drawrace_lobby_size`
- `drawrace_http_request_duration_seconds_*`
- `kube_deployment_status_replicas_available`

## Notes
- The dashboard uses Prometheus datasource with UID `prometheus`
- Refresh interval set to 30 seconds
- Time range default: 6 hours
- Dashboard UID: `drawrace-quality`
- Tags: drawrace, quality, validation, physics
