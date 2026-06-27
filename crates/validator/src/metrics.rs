/// Prometheus metrics for replay-mismatch monitoring.
///
/// Tracks submission validation outcomes with focus on re-simulation
/// rejection rates for physics drift detection.
use metrics::counter;
use metrics::gauge;

/// Increment the total submissions counter.
pub fn inc_submissions_total() {
    counter!("drawrace_validator_submissions_total").increment(1);
}

/// Increment accepted submissions counter.
pub fn inc_accepted() {
    counter!("drawrace_validator_accepted_total").increment(1);
}

/// Increment rejected submissions counter.
pub fn inc_rejected() {
    counter!("drawrace_validator_rejected_total").increment(1);
}

/// Increment quarantined submissions counter.
pub fn inc_quarantined() {
    counter!("drawrace_validator_quarantined_total").increment(1);
}

/// Increment rejected submissions by reason.
pub fn inc_rejected_reason(reason: &str) {
    counter!("drawrace_validator_rejected_by_reason_total", "reason" => reason.to_string())
        .increment(1);
}

/// Increment resim mismatch rejections (finish tick diff > tolerance).
pub fn inc_resim_mismatch() {
    counter!("drawrace_validator_resim_mismatch_total").increment(1);
}

/// Update the current rejection rate gauge (percentage).
#[allow(dead_code)]
pub fn set_rejection_rate(rate: f64) {
    gauge!("drawrace_validator_rejection_rate_percent").set(rate);
}

/// Update the resim rejection rate gauge (percentage of rejections due to resim mismatch).
#[allow(dead_code)]
pub fn set_resim_rejection_rate(rate: f64) {
    gauge!("drawrace_validator_resim_rejection_rate_percent").set(rate);
}

/// Record a resim tick difference (for histogram/distribution analysis).
#[allow(dead_code)]
pub fn record_tick_diff(diff: u32) {
    counter!("drawrace_validator_resim_tick_diff", "diff_bucket" => tick_diff_bucket(diff))
        .increment(1);
}

/// Bucket tick differences for histogram analysis.
#[allow(dead_code)]
fn tick_diff_bucket(diff: u32) -> String {
    match diff {
        0..=2 => "0-2".to_string(),
        3..=5 => "3-5".to_string(),
        6..=10 => "6-10".to_string(),
        11..=20 => "11-20".to_string(),
        21..=50 => "21-50".to_string(),
        51..=100 => "51-100".to_string(),
        _ => "100+".to_string(),
    }
}
