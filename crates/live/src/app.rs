//! Application state and routing for drawrace-live

use axum::{extract::State, routing::get, Router};
use redis::{aio::ConnectionManager, Client as RedisClient};
use std::sync::Arc;

use crate::physics::{GlobalPhysicsEngine, RaceExecutor};
use crate::redis_health::RedisHealthMonitor;
use crate::redis_pubsub::RedisSubscription;
use crate::room::RoomRegistry;
use crate::websocket::{websocket_handler, ConnectionRegistry};

/// Shared application state
pub struct LiveState {
    /// Room registry (in-memory, pod-local)
    pub rooms: RoomRegistry,
    /// Connection registry (active WebSocket connections)
    pub connections: ConnectionRegistry,
    /// Redis client
    pub redis: RedisClient,
    /// Redis connection manager
    pub redis_mgr: Arc<tokio::sync::Mutex<ConnectionManager>>,
    /// Redis health monitor
    pub redis_health: Arc<RedisHealthMonitor>,
    /// Redis pub/sub subscription with reconnection
    pub redis_subscription: Arc<RedisSubscription>,
    /// This pod's IP (for room registration)
    pub pod_ip: String,
    /// Race executor (runs authoritative simulation for active races)
    pub race_executor: Arc<RaceExecutor>,
    /// Global physics engine (loaded once at startup)
    pub physics_engine: Arc<GlobalPhysicsEngine>,
}

/// Create the axum router
pub fn app(state: Arc<LiveState>) -> Router {
    Router::new()
        .route("/ws", get(websocket_handler))
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        .with_state(state)
}

/// Health check handler with Redis connectivity and subscription verification
async fn health_handler(State(state): State<Arc<LiveState>>) -> (axum::http::StatusCode, axum::Json<serde_json::Value>) {
    // Check Redis health status
    let redis_status = state.redis_health.health_status().await;
    let is_healthy = redis_status == crate::redis_health::HealthStatus::Healthy;

    // Try to verify Redis connectivity if status appears healthy
    let redis_connected = if is_healthy {
        match state.redis_health.check_health().await {
            Ok(_) => true,
            Err(e) => {
                tracing::warn!("Redis health check failed during health endpoint: {}", e);
                false
            }
        }
    } else {
        false
    };

    // Check Redis subscription health
    let subscription_health = state.redis_subscription.health_status().await;
    let subscription_healthy = subscription_health == crate::redis_pubsub::SubscriptionHealth::Active;

    // Get subscription counts (these are now async)
    let redis_reconnect_count = state.redis_health.reconnect_count().await;
    let subscription_reconnect_count = state.redis_subscription.reconnect_count().await;
    let active_subscriptions = state.redis_subscription.subscription_count().await;

    // Return HTTP 503 if Redis is not healthy OR subscriptions are dead (triggers liveness probe failure)
    let status_code = if redis_connected && subscription_healthy {
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::SERVICE_UNAVAILABLE
    };

    let response = serde_json::json!({
        "status": if redis_connected && subscription_healthy { "ok" } else { "unhealthy" },
        "service": "drawrace-live",
        "redis": {
            "connected": redis_connected,
            "status": format!("{:?}", redis_status),
            "reconnect_count": redis_reconnect_count
        },
        "subscription": {
            "healthy": subscription_healthy,
            "status": format!("{:?}", subscription_health),
            "reconnect_count": subscription_reconnect_count,
            "active_subscriptions": active_subscriptions
        }
    });

    (status_code, axum::Json(response))
}

/// Prometheus metrics handler
async fn metrics_handler(State(state): State<Arc<LiveState>>) -> String {
    let connection_count = state.connections.count().await;
    let room_count = state.rooms.count().await;
    let race_count = state.race_executor.race_count().await;

    format!(
        "# HELP drawrace_websocket_connections Number of active WebSocket connections\n\
         # TYPE drawrace_websocket_connections gauge\n\
         drawrace_websocket_connections {}\n\
         # HELP drawrace_rooms_active Number of active race rooms\n\
         # TYPE drawrace_rooms_active gauge\n\
         drawrace_rooms_active {}\n\
         # HELP drawrace_races_active Number of active races\n\
         # TYPE drawrace_races_active gauge\n\
         drawrace_races_active {}\n",
        connection_count, room_count, race_count,
    )
}

impl LiveState {
    pub fn new(
        redis: RedisClient,
        redis_mgr: ConnectionManager,
        pod_ip: String,
        physics_engine: Arc<GlobalPhysicsEngine>,
    ) -> Self {
        let engine = physics_engine.engine();
        let track_store = physics_engine.track_store();

        // Create health monitor with the provided connection manager
        // The health monitor will create its own separate manager when reconnecting
        let redis_health = RedisHealthMonitor::new(redis.clone(), redis_mgr.clone());

        // Create Redis subscription manager with reconnection capability
        let redis_subscription = RedisSubscription::new(redis.clone(), redis_mgr.clone());

        LiveState {
            rooms: RoomRegistry::new(),
            connections: ConnectionRegistry::new(),
            redis_mgr: Arc::new(tokio::sync::Mutex::new(redis_mgr)),
            redis,
            pod_ip,
            race_executor: Arc::new(RaceExecutor::new(engine.clone(), track_store.clone())),
            physics_engine,
            redis_health: Arc::new(redis_health),
            redis_subscription: Arc::new(redis_subscription),
        }
    }
}
