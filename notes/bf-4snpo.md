# DrawRace/Quality Grafana Dashboard

## Task
Create Grafana DrawRace/Quality dashboard on ardenone-cluster with 8 metrics panels as specified in Plan §Testing 14.

## Work Completed

### Dashboard Created
Created `/monitoring/drawrace-quality-dashboard.json` with the following 8 panels:

1. **Submission Rate**
   - Timeseries: `sum(rate(drawrace_validator_submissions_total[5m]))` submissions/sec
   - Shows accepted, ephemeral outcomes
   - Total submissions (24h) stat panel
   - Outcome distribution pie chart (accepted/rejected/quarantined)

2. **Re-sim Pass Rate**
   - Stat panel (1h avg): `sum(rate(drawrace_validator_accepted_total[1h])) / sum(rate(drawrace_validator_submissions_total[1h]))`
   - Timeseries with 98% target threshold
   - Thresholds: red (<90%), orange (95%), yellow (95%), green (98%+)
   - Validator queue depth panel

3. **P95 Latency** (API request latency as proxy for re-sim latency)
   - `histogram_quantile(0.95, sum(rate(drawrace_http_request_duration_seconds_bucket[5m])) by (le, route))`
   - 400ms target threshold
   - API request rate breakdown (total/read/write)

4. **Ghost Pool Size**
   - Ghost blob storage: `drawrace_ghost_blob_bytes`
   - Ghost pool growth rate panel

5. **Active Sessions**
   - WebSocket connections gauge: `drawrace_websocket_connections`
   - Active rooms gauge: `drawrace_rooms_active`
   - Active racers gauge: `sum(drawrace_racers_active)`

6. **Physics Version Drift**
   - Replay mismatch rate (physics drift indicator): `sum(rate(drawrace_validator_resim_mismatch_total[5m])) / sum(rate(drawrace_validator_submissions_total[5m]))`
   - Tick difference distribution (drift analysis)
   - Alert thresholds at 0.5% and 1%

7. **Error Rate by Type**
   - Rejection rate by reason (timeseries): `sum by (reason) (rate(drawrace_validator_rejected_by_reason_total[5m]))`
   - Error distribution pie chart

8. **CDN Cache Hit Rate**
   - Placeholder panel - requires Cloudflare webhook integration
   - Description notes: "Configure Cloudflare webhook" needed

### Additional Panels Included
- API Pod Availability
- Validator Pod Availability
- Submission outcome distribution

### Dashboard Details
- **File**: `monitoring/drawrace-quality-dashboard.json`
- **UID**: `drawrace-quality`
- **Title**: DrawRace / Quality
- **Tags**: drawrace, quality, health
- **Refresh**: 30s
- **Time range**: now-6h to now
- **Schema Version**: 39

### Deployment
Dashboard JSON is ready for import into Grafana on ardenone-cluster via:
- Grafana UI dashboard import feature
- Grafana API provisioning
- Or converted to ConfigMap for automated deployment

### Metrics Used
- `drawrace_validator_submissions_total`
- `drawrace_validator_accepted_total`
- `drawrace_validator_rejected_total`
- `drawrace_validator_quarantined_total`
- `drawrace_validator_resim_mismatch_total`
- `drawrace_validator_resim_tick_diff`
- `drawrace_validator_rejected_by_reason_total`
- `drawrace_ghost_blob_bytes`
- `drawrace_submissions_total`
- `drawrace_websocket_connections`
- `drawrace_rooms_active`
- `drawrace_racers_active`
- `drawrace_http_request_duration_seconds_*`
- `drawrace_validator_queue_depth`
- `kube_deployment_status_replicas_available`
- `kube_statefulset_status_replicas_ready`

## Notes
- Dashboard follows same format as existing dashboards in `/monitoring/`
- CDN cache hit rate panel is a placeholder requiring Cloudflare integration
- API latency used as proxy for re-sim latency since re-sim duration histogram not currently exposed
