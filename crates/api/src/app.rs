use axum::Router;
use sqlx::PgPool;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::handlers::health;
use crate::handlers::health::{CachedValidator, ReadinessState};

pub use crate::handlers::health::{ApiInfo, HealthResponse, ValidatorInfo};

pub struct AppState {
    pub pool: PgPool,
    pub validator_cache: tokio::sync::RwLock<CachedValidator>,
    pub readiness: ReadinessState,
}

impl AppState {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            validator_cache: tokio::sync::RwLock::new(CachedValidator {
                physics_version: 0,
                engine_core_wasm_sha256: String::new(),
                ok: false,
                last_success: std::time::Instant::now(),
            }),
            readiness: ReadinessState {
                has_ever_polled: std::sync::atomic::AtomicBool::new(false),
                boot_instant: std::time::Instant::now(),
            },
        }
    }
}

pub fn app(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/v1/health", axum::routing::get(health::health_handler))
        .route("/v1/health/ready", axum::routing::get(health::ready_handler))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state)
}
