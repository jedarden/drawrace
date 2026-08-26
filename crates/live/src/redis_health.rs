//! Redis connection health monitoring and reconnection
//!
//! Provides watchdog functionality for monitoring Redis connectivity
//! and implementing exponential backoff reconnection logic.

use anyhow::{Context, Result};
use redis::{aio::ConnectionManager, Client as RedisClient};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tracing::{error, info, warn};

/// Configuration for reconnection behavior
const MAX_RECONNECT_ATTEMPTS: u32 = 10;
const BASE_BACKOFF_MS: u64 = 100; // Start at 100ms
const MAX_BACKOFF_MS: u64 = 30000; // Cap at 30 seconds
const HEALTH_CHECK_INTERVAL: Duration = Duration::from_secs(5);

/// Redis connection health state
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
}

/// Redis connection health monitor with reconnection capability
pub struct RedisHealthMonitor {
    redis: RedisClient,
    mgr: Arc<Mutex<Option<ConnectionManager>>>, // Option to allow late initialization
    status: Arc<Mutex<HealthStatus>>,
    last_check: Arc<Mutex<Instant>>,
    reconnect_count: Arc<Mutex<u32>>,
}

impl RedisHealthMonitor {
    /// Create a new health monitor
    pub fn new(redis: RedisClient, mgr: ConnectionManager) -> Self {
        Self {
            redis,
            mgr: Arc::new(Mutex::new(Some(mgr))),
            status: Arc::new(Mutex::new(HealthStatus::Healthy)),
            last_check: Arc::new(Mutex::new(Instant::now())),
            reconnect_count: Arc::new(Mutex::new(0)),
        }
    }

    /// Check Redis connectivity with a simple PING command
    pub async fn check_health(&self) -> Result<()> {
        let mut mgr_guard = self.mgr.lock().await;

        // Create connection manager if needed
        if mgr_guard.is_none() {
            *mgr_guard = Some(self.create_connection_manager().await?);
        }

        let mgr = mgr_guard.as_mut().context("Connection manager not initialized")?;
        let pong: String = redis::cmd("PING")
            .query_async(mgr)
            .await
            .context("Redis PING failed")?;

        if pong != "PONG" {
            anyhow::bail!("Unexpected PING response: {}", pong);
        }

        // Update health status
        *self.status.lock().await = HealthStatus::Healthy;
        *self.last_check.lock().await = Instant::now();

        Ok(())
    }

    /// Get current health status
    pub async fn health_status(&self) -> HealthStatus {
        // Check if health status is stale (older than 2x check interval)
        let last_check = *self.last_check.lock().await;
        if last_check.elapsed() > HEALTH_CHECK_INTERVAL * 2 {
            return HealthStatus::Degraded;
        }

        *self.status.lock().await
    }

    /// Get the number of reconnection attempts
    pub async fn reconnect_count(&self) -> u32 {
        *self.reconnect_count.lock().await
    }

    /// Attempt to reconnect to Redis with exponential backoff
    pub async fn reconnect_with_backoff(&self) -> Result<()> {
        let mut attempt = 0;
        let mut backoff_ms = BASE_BACKOFF_MS;

        while attempt < MAX_RECONNECT_ATTEMPTS {
            attempt += 1;
            *self.reconnect_count.lock().await += 1;

            info!(
                attempt = attempt,
                backoff_ms = backoff_ms,
                "Attempting Redis reconnection"
            );

            // Emit reconnection attempt metric
            metrics::counter!("drawrace_redis_reconnect_attempts").increment(1);

            // Try to create a new connection manager
            match self.create_connection_manager().await {
                Ok(new_mgr) => {
                    // Replace the old connection manager
                    *self.mgr.lock().await = Some(new_mgr);
                    *self.status.lock().await = HealthStatus::Healthy;
                    *self.last_check.lock().await = Instant::now();

                    info!(
                        attempts = attempt,
                        "Successfully reconnected to Redis"
                    );

                    // Emit success metric
                    metrics::counter!("drawrace_redis_reconnect_success").increment(1);
                    let reconnect_count = *self.reconnect_count.lock().await;
                    // Use increment for reconnect count tracking
                    metrics::gauge!("drawrace_redis_reconnect_count").increment(1.0);
                    // Reset to current value (simulating absolute set)
                    for _ in 1..reconnect_count {
                        metrics::gauge!("drawrace_redis_reconnect_count").increment(1.0);
                    }

                    return Ok(());
                }
                Err(e) => {
                    warn!(
                        attempt = attempt,
                        error = %e,
                        "Reconnection attempt failed"
                    );

                    // Update status to unhealthy
                    *self.status.lock().await = HealthStatus::Unhealthy;
                }
            }

            // Exponential backoff
            if attempt < MAX_RECONNECT_ATTEMPTS {
                tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                backoff_ms = (backoff_ms * 2).min(MAX_BACKOFF_MS);
            }
        }

        error!(
            attempts = attempt,
            "Failed to reconnect to Redis after maximum attempts"
        );

        // Emit failure metric
        metrics::counter!("drawrace_redis_reconnect_failure").increment(1);

        anyhow::bail!("Failed to reconnect to Redis after {} attempts", attempt)
    }

    /// Create a new connection manager
    async fn create_connection_manager(&self) -> Result<ConnectionManager> {
        self.redis
            .get_connection_manager()
            .await
            .context("Failed to create Redis connection manager")
    }

    /// Run watchdog task to monitor Redis health
    pub async fn run_watchdog(self: Arc<Self>) {
        info!("Starting Redis health watchdog");

        loop {
            tokio::time::sleep(HEALTH_CHECK_INTERVAL).await;

            // Check current health status
            let current_status = self.health_status().await;

            // If status is degraded or unhealthy, attempt health check
            if current_status != HealthStatus::Healthy {
                warn!(
                    status = ?current_status,
                    "Redis health check overdue, attempting verification"
                );

                match self.check_health().await {
                    Ok(_) => {
                        info!("Redis health check passed");
                    }
                    Err(e) => {
                        error!(error = %e, "Redis health check failed, attempting reconnection");

                        // Attempt reconnection with backoff
                        if let Err(reconnect_err) = self.reconnect_with_backoff().await {
                            error!(
                                error = %reconnect_err,
                                "Failed to reconnect to Redis, pod should be restarted"
                            );

                            // Emit critical failure metric
                            metrics::counter!("drawrace_redis_reconnect_critical").increment(1);

                            // Sleep longer before next attempt to avoid tight failure loop
                            tokio::time::sleep(Duration::from_secs(30)).await;
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exponential_backoff_calculation() {
        let mut backoff = BASE_BACKOFF_MS;

        for i in 1..=10 {
            let expected = (BASE_BACKOFF_MS * 2u64.pow(i - 1)).min(MAX_BACKOFF_MS);
            assert_eq!(backoff, expected);
            backoff = (backoff * 2).min(MAX_BACKOFF_MS);
        }

        // Should cap at MAX_BACKOFF_MS
        assert_eq!(backoff, MAX_BACKOFF_MS);
    }

    #[test]
    fn test_health_status_display() {
        let status = HealthStatus::Healthy;
        assert_eq!(format!("{:?}", status), "Healthy");
    }
}
