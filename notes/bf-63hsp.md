# Phase 4 Beta: Replay-Mismatch Dashboard + Email Alerts

## Completed (Commit 6656bef)

Phase 4 deliverable was implemented in commit `6656bef feat(validator): add replay-mismatch dashboard and Prometheus metrics`.

### Components Implemented

#### 1. Validator Metrics Endpoint
- **File:** `crates/validator/src/metrics.rs`
- Prometheus counters for:
  - `drawrace_validator_submissions_total` - Total submissions
  - `drawrace_validator_accepted_total` - Accepted submissions
  - `drawrace_validator_rejected_total` - Rejected submissions
  - `drawrace_validator_quarantined_total` - Quarantined submissions
  - `drawrace_validator_rejected_by_reason_total` - Rejections by reason
  - `drawrace_validator_resim_mismatch_total` - Resim mismatches (physics drift)
  - `drawrace_validator_resim_tick_diff` - Tick difference distribution

- **Endpoint:** `/metrics` on port 8080
- **Scrape interval:** 30s (via ServiceMonitor)

#### 2. Grafana Dashboard
- **File:** `monitoring/replay-mismatch-dashboard.json`
- Panels:
  - Overall Rejection Rate (1h stat)
  - Resim Mismatch Rate (1h stat)
  - Quarantine Rate (1h stat)
  - Rejection Rate Over Time (with alert thresholds)
  - Resim Mismatch Rate Over Time (with alert thresholds)
  - Rejections by Reason (pie chart + time series)
  - Tick Difference Distribution (bar gauge)
  - Submission Throughput
  - Accepted vs Rejected (time series)
  - Cumulative Submissions

#### 3. PrometheusRule Alerts
- **File:** `k8s/servicemonitor.yaml`
- Alerts:
  - `DrawRaceReplayMismatchHigh` (>1% for 10min) - warning severity
  - `DrawRaceReplayMismatchCritical` (>2% for 5min) - critical severity
  - `DrawRaceHighRejectionRate` (>5% for 10min) - warning severity
  - `DrawRaceQuarantineSpike` (>0.1% for 15min) - warning severity

#### 4. ServiceMonitor & NetworkPolicy
- **ServiceMonitor:** Configures Prometheus to scrape `/metrics` every 30s
- **NetworkPolicy:** `drawrace-allow-validator-metrics` allows Prometheus namespace access to port 8080

#### 5. Email Alerts
Email delivery is handled by Alertmanager at the cluster level. The PrometheusRule forwards alerts to Alertmanager, which routes them to email based on the alert `severity` label:
- `warning` severity → warning email
- `critical` severity → critical email (higher priority)

This is the standard Prometheus/Alertmanager pattern - alert definitions live in PrometheusRule, while delivery configuration lives in Alertmanager.

## Verification

All components are deployed via the existing GitOps pipeline (`k8s/` path synced by ArgoCD). The dashboard UID is `drawrace-replay-mismatch` and can be imported into Grafana via the declarative-config dashboard provisioning or manually via the JSON import.
