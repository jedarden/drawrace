use aws_sdk_s3::Client as S3Client;
use axum::Router;
use sqlx::PgPool;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::handlers::health;
use crate::handlers::health::{CachedValidator, ReadinessState};
use crate::hmac_mod::HmacConfig;

pub use crate::handlers::health::{ApiInfo, HealthResponse, ValidatorInfo};

pub struct AppState {
    pub pool: PgPool,
    pub redis: deadpool_redis::Pool,
    pub s3: S3Client,
    pub s3_bucket: String,
    pub hmac_config: tokio::sync::RwLock<HmacConfig>,
    pub validator_cache: tokio::sync::RwLock<CachedValidator>,
    pub readiness: ReadinessState,
}

pub fn app(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/v1/health", axum::routing::get(health::health_handler))
        .route(
            "/v1/health/ready",
            axum::routing::get(health::ready_handler),
        )
        .route(
            "/v1/submissions",
            axum::routing::post(crate::handlers::submissions::post_submission),
        )
        .route(
            "/v1/submissions/{submission_id}",
            axum::routing::get(crate::handlers::submissions::get_submission),
        )
        .route(
            "/v1/names",
            axum::routing::post(crate::handlers::names::post_name),
        )
        .route(
            "/v1/ghosts/{ghost_id}",
            axum::routing::get(crate::handlers::ghosts::get_ghost),
        )
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state)
}
