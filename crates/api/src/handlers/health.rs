use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Json;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use crate::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct ValidatorInfo {
    pub physics_version: u16,
    pub engine_core_wasm_sha256: String,
    pub ok: bool,
    pub age_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthResponse {
    pub api: ApiInfo,
    pub validator: ValidatorInfo,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiInfo {
    pub ok: bool,
    pub version: String,
}

#[derive(Debug)]
pub struct CachedValidator {
    pub physics_version: u16,
    pub engine_core_wasm_sha256: String,
    pub ok: bool,
    pub last_success: Instant,
}

pub struct ReadinessState {
    pub has_ever_polled: AtomicBool,
    pub boot_instant: Instant,
}

pub async fn health_handler(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    let validator = state.validator_cache.read().await;
    let age = validator.last_success.elapsed().as_secs();

    Json(HealthResponse {
        api: ApiInfo {
            ok: true,
            version: env!("CARGO_PKG_VERSION").to_string(),
        },
        validator: ValidatorInfo {
            physics_version: validator.physics_version,
            engine_core_wasm_sha256: validator.engine_core_wasm_sha256.clone(),
            ok: validator.ok && age <= 30,
            age_seconds: age,
        },
    })
}

pub async fn ready_handler(State(state): State<Arc<AppState>>) -> Result<&'static str, StatusCode> {
    let readiness = &state.readiness;
    let elapsed = readiness.boot_instant.elapsed().as_secs();
    let has_polled = readiness.has_ever_polled.load(Ordering::Relaxed);

    if has_polled {
        return Ok("ok");
    }

    if elapsed < 120 {
        tracing::warn!(
            elapsed_s = elapsed,
            "readiness: in grace period, validator not yet reachable"
        );
        return Ok("ok");
    }

    Err(StatusCode::SERVICE_UNAVAILABLE)
}
