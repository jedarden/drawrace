pub mod app;
pub mod db;
pub mod handlers;

pub use app::AppState;

use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let listen_addr = std::env::var("LISTEN_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());

    let pool = db::create_pool(&database_url)
        .await
        .expect("failed to create Postgres pool");

    db::run_migrations(&pool)
        .await
        .expect("failed to run migrations");

    let state = Arc::new(AppState::new(pool));
    let app = app::app(state);

    let listener = tokio::net::TcpListener::bind(&listen_addr)
        .await
        .expect("failed to bind listener");

    tracing::info!(addr = %listen_addr, "drawrace-api listening");
    axum::serve(listener, app).await.expect("server error");
}
