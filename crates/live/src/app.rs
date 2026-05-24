//! Application state and routing for drawrace-live

use axum::{
    extract::State,
    routing::get,
    Router,
    response::Json,
};
use redis::{Client as RedisClient, aio::ConnectionManager};
use std::sync::Arc;

use crate::room::RoomRegistry;
use crate::websocket::{websocket_handler, ConnectionRegistry};
use crate::physics::RaceExecutor;

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
    /// This pod's IP (for room registration)
    pub pod_ip: String,
    /// Race executor (runs authoritative simulation for active races)
    pub race_executor: Arc<RaceExecutor>,
}

/// Create the axum router
pub fn app(state: Arc<LiveState>) -> Router {
    Router::new()
        .route("/ws", get(websocket_handler))
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        .with_state(state)
}

/// Health check handler
async fn health_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "drawrace-live"
    }))
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
        connection_count,
        room_count,
        race_count,
    )
}

impl LiveState {
    pub fn new(redis: RedisClient, redis_mgr: ConnectionManager, pod_ip: String) -> Self {
        LiveState {
            rooms: RoomRegistry::new(),
            connections: ConnectionRegistry::new(),
            redis,
            redis_mgr: Arc::new(tokio::sync::Mutex::new(redis_mgr)),
            pod_ip,
            race_executor: Arc::new(RaceExecutor::new()),
        }
    }
}
