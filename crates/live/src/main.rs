use anyhow::Result;
use axum::Router;
use drawrace_live::{LiveState, background};
use metrics_exporter_prometheus::PrometheusBuilder;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tracing_subscriber::{EnvFilter, fmt};
use tracing::Level;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    fmt()
        .json()
        .with_env_filter(
            EnvFilter::builder()
                .with_default_directive(Level::INFO.into())
                .from_env_lossy(),
        )
        .init();

    // Install Prometheus metrics exporter
    let recorder = PrometheusBuilder::new().build_recorder();
    let metrics_handle = recorder.handle();
    metrics::set_global_recorder(recorder)?;

    // Load configuration from environment
    let redis_url = std::env::var("REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let listen_addr = std::env::var("LISTEN_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let pod_ip = std::env::var("POD_IP")
        .unwrap_or_else(|_| "127.0.0.1".to_string());

    // Create Redis client and connection manager
    let redis = redis::Client::open(redis_url)?;
    let redis_mgr = redis.get_tokio_connection_manager().await?;

    // Create application state
    let state = Arc::new(LiveState::new(redis, redis_mgr, pod_ip));

    // Build router
    let app = drawrace_live::app(state.clone());

    // Start lobby background task
    let state_clone = state.clone();
    tokio::spawn(async move {
        background::run_lobby_task(&state_clone).await;
    });

    // Start server
    let addr: SocketAddr = listen_addr.parse()?;
    let listener = TcpListener::bind(addr).await?;

    tracing::info!(addr = %addr, "drawrace-live listening");

    axum::serve(listener, app).await?;

    Ok(())
}
