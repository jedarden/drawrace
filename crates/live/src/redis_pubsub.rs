//! Redis pub/sub subscription management with reconnection
//!
//! Provides robust Redis pub/sub subscription handling with:
//! - Automatic reconnection on connection failure
//! - Exponential backoff retry logic
//! - Subscription state recovery
//! - Telemetry for reconnection events

use anyhow::{Context, Result};
use redis::{aio::ConnectionManager, Client as RedisClient};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, mpsc};
use tracing::{error, info, warn};

/// Configuration for reconnection behavior
const MAX_RECONNECT_ATTEMPTS: u32 = 10;
const BASE_BACKOFF_MS: u64 = 100; // Start at 100ms
const MAX_BACKOFF_MS: u64 = 30000; // Cap at 30 seconds
const SUBSCRIPTION_HEALTH_CHECK_INTERVAL: Duration = Duration::from_secs(10);

/// Subscription health state
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SubscriptionHealth {
    Active,
    Stale,
    Dead,
}

/// Redis pub/sub subscription with reconnection capability
pub struct RedisSubscription {
    redis: RedisClient,
    mgr: Arc<Mutex<Option<ConnectionManager>>>,
    channels: Arc<Mutex<Vec<String>>>,
    pattern_channels: Arc<Mutex<Vec<String>>>,
    health: Arc<Mutex<SubscriptionHealth>>,
    last_message: Arc<Mutex<Instant>>,
    reconnect_count: Arc<Mutex<u32>>,
    is_running: Arc<Mutex<bool>>,
    subscription_tx: mpsc::UnboundedSender<String>,
}

impl RedisSubscription {
    /// Create a new Redis pub/sub subscription
    pub fn new(redis: RedisClient, mgr: ConnectionManager) -> Self {
        let (subscription_tx, _subscription_rx) = mpsc::unbounded_channel();

        Self {
            redis,
            mgr: Arc::new(Mutex::new(Some(mgr))),
            channels: Arc::new(Mutex::new(Vec::new())),
            pattern_channels: Arc::new(Mutex::new(Vec::new())),
            health: Arc::new(Mutex::new(SubscriptionHealth::Active)),
            last_message: Arc::new(Mutex::new(Instant::now())),
            reconnect_count: Arc::new(Mutex::new(0)),
            is_running: Arc::new(Mutex::new(false)),
            subscription_tx,
        }
    }

    /// Subscribe to a specific channel (thread-safe)
    pub async fn subscribe(&self, channel: &str) {
        let mut channels = self.channels.lock().await;
        if !channels.contains(&channel.to_string()) {
            channels.push(channel.to_string());
            // Send notification if needed for future processing
            let _ = self.subscription_tx.send(channel.to_string());
        }
    }

    /// Subscribe to a pattern (glob-style) (thread-safe)
    pub async fn psubscribe(&self, pattern: &str) {
        let mut pattern_channels = self.pattern_channels.lock().await;
        if !pattern_channels.contains(&pattern.to_string()) {
            pattern_channels.push(pattern.to_string());
            let _ = self.subscription_tx.send(pattern.to_string());
        }
    }

    /// Get current subscription health
    pub async fn health_status(&self) -> SubscriptionHealth {
        let health = *self.health.lock().await;
        let last_msg = *self.last_message.lock().await;

        // Consider subscription stale if no messages for 3x health check interval
        if health == SubscriptionHealth::Active && last_msg.elapsed() > SUBSCRIPTION_HEALTH_CHECK_INTERVAL * 3 {
            SubscriptionHealth::Stale
        } else {
            health
        }
    }

    /// Get the number of reconnection attempts
    pub async fn reconnect_count(&self) -> u32 {
        *self.reconnect_count.lock().await
    }

    /// Get the number of active subscriptions
    pub async fn subscription_count(&self) -> usize {
        let channels = self.channels.lock().await;
        let patterns = self.pattern_channels.lock().await;
        channels.len() + patterns.len()
    }

    /// Update last message timestamp (call this when receiving messages)
    pub async fn update_last_message(&self) {
        *self.last_message.lock().await = Instant::now();
        *self.health.lock().await = SubscriptionHealth::Active;
    }

    /// Mark subscription as dead
    pub async fn mark_dead(&self) {
        *self.health.lock().await = SubscriptionHealth::Dead;
        error!("Redis subscription marked as dead");
        metrics::counter!("drawrace_redis_subscription_dead").increment(1);
    }

    /// Attempt to reconnect the subscription with exponential backoff
    pub async fn reconnect_with_backoff(&self) -> Result<()> {
        let mut attempt = 0;
        let mut backoff_ms = BASE_BACKOFF_MS;

        while attempt < MAX_RECONNECT_ATTEMPTS {
            attempt += 1;
            *self.reconnect_count.lock().await += 1;

            info!(
                attempt = attempt,
                backoff_ms = backoff_ms,
                subscriptions = self.subscription_count(),
                "Attempting Redis subscription reconnection"
            );

            // Emit reconnection attempt metric
            metrics::counter!("drawrace_redis_subscription_reconnect_attempts").increment(1);

            // Try to create a new connection manager and re-subscribe
            match self.recreate_subscription().await {
                Ok(_) => {
                    *self.health.lock().await = SubscriptionHealth::Active;
                    *self.last_message.lock().await = Instant::now();

                    info!(
                        attempts = attempt,
                        channels = self.channels.len(),
                        patterns = self.pattern_channels.len(),
                        "Successfully reconnected Redis subscriptions"
                    );

                    // Emit success metrics
                    metrics::counter!("drawrace_redis_subscription_reconnect_success").increment(1);
                    let reconnect_count = *self.reconnect_count.lock().await;
                    // Set reconnect count using increment
                    metrics::gauge!("drawrace_redis_subscription_reconnect_count").increment(1.0);
                    for _ in 1..reconnect_count {
                        metrics::gauge!("drawrace_redis_subscription_reconnect_count").increment(1.0);
                    }
                    // Set subscriptions count
                    let sub_count = self.subscription_count();
                    metrics::gauge!("drawrace_redis_subscriptions_active").increment(sub_count as f64);

                    return Ok(());
                }
                Err(e) => {
                    warn!(
                        attempt = attempt,
                        error = %e,
                        "Redis subscription reconnection attempt failed"
                    );

                    *self.health.lock().await = SubscriptionHealth::Dead;
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
            "Failed to reconnect Redis subscriptions after maximum attempts"
        );

        // Emit failure metric
        metrics::counter!("drawrace_redis_subscription_reconnect_failure").increment(1);

        anyhow::bail!("Failed to reconnect Redis subscriptions after {} attempts", attempt)
    }

    /// Recreate the connection and subscriptions
    async fn recreate_subscription(&self) -> Result<()> {
        // Create new connection manager
        let new_mgr = self.redis.get_connection_manager().await
            .context("Failed to create connection manager for subscription")?;

        // Store the new manager
        *self.mgr.lock().await = Some(new_mgr);

        // Get current channels and patterns to re-subscribe
        let channels = self.channels.lock().await.clone();
        let patterns = self.pattern_channels.lock().await.clone();

        // Re-subscribe to all channels and patterns
        let mut mgr_guard = self.mgr.lock().await;
        let mgr = mgr_guard.as_mut().context("Connection manager not initialized")?;

        // Subscribe to channels
        if !channels.is_empty() {
            let _: () = redis::cmd("SUBSCRIBE")
                .arg(channels.as_slice())
                .query_async(mgr)
                .await
                .context("Failed to subscribe to channels")?;
        }

        // Subscribe to patterns
        if !patterns.is_empty() {
            let _: () = redis::cmd("PSUBSCRIBE")
                .arg(patterns.as_slice())
                .query_async(mgr)
                .await
                .context("Failed to subscribe to patterns")?;
        }

        info!(
            "Redis subscriptions recreated: channels={}, patterns={}",
            channels.len(), patterns.len()
        );

        Ok(())
    }

    /// Run subscription health watchdog
    pub async fn run_watchdog(self: Arc<Self>) {
        tracing::info!("Starting Redis subscription health watchdog");

        loop {
            tokio::time::sleep(SUBSCRIPTION_HEALTH_CHECK_INTERVAL).await;

            // Check if we should stop
            if !*self.is_running.lock().await {
                tracing::info!("Redis subscription watchdog stopped");
                return;
            }

            let health = self.health_status().await;

            match health {
                SubscriptionHealth::Active => {
                    // Everything is fine - increment to 1.0
                    let health_gauge = metrics::gauge!("drawrace_redis_subscription_health");
                    health_gauge.increment(1.0);
                }
                SubscriptionHealth::Stale => {
                    let elapsed = self.last_message.lock().await.elapsed().as_millis();
                    tracing::warn!(
                        "Redis subscription is stale (no messages for {} ms)", elapsed
                    );
                    let health_gauge = metrics::gauge!("drawrace_redis_subscription_health");
                    health_gauge.increment(0.5);
                    metrics::counter!("drawrace_redis_subscription_stale").increment(1);

                    // Try to refresh subscription
                    if let Err(e) = self.reconnect_with_backoff().await {
                        tracing::error!("Failed to refresh stale Redis subscription: {}", e);
                    }
                }
                SubscriptionHealth::Dead => {
                    tracing::error!("Redis subscription is dead, attempting reconnection");
                    // Reset to 0.0 by not incrementing (gauge starts at 0)
                    metrics::counter!("drawrace_redis_subscription_dead").increment(1);

                    // Attempt reconnection with backoff
                    if let Err(e) = self.reconnect_with_backoff().await {
                        tracing::error!(
                            "Failed to reconnect dead Redis subscription, service degraded: {}", e
                        );

                        // Sleep longer to avoid tight failure loop
                        tokio::time::sleep(Duration::from_secs(30)).await;
                    }
                }
            }
        }
    }

    /// Start the subscription processing (must be implemented by caller)
    pub async fn start(&self) {
        *self.is_running.lock().await = true;
        tracing::info!("Starting Redis subscription processing");
    }

    /// Stop the subscription processing
    pub async fn stop(&self) {
        *self.is_running.lock().await = false;
        tracing::info!("Stopping Redis subscription processing");
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
    fn test_subscription_health_display() {
        let health = SubscriptionHealth::Active;
        assert_eq!(format!("{:?}", health), "Active");
    }

    #[test]
    fn test_subscription_count() {
        let redis_client = redis::Client::open("redis://127.0.0.1").unwrap();
        let sub = RedisSubscription::new(redis_client, redis_client.get_connection_manager().await.unwrap());

        assert_eq!(sub.subscription_count(), 0);

        // Test would need async context to add subscriptions
    }
}
