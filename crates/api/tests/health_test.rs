use aws_config::BehaviorVersion;
use aws_sdk_s3::Client as S3Client;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use drawrace_api::app;
use drawrace_api::hmac_mod::HmacConfig;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tower::ServiceExt;

async fn test_app() -> Router {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_lazy("postgres://test:test@localhost:5432/drawrace_test")
        .expect("pool");

    let redis_pool =
        deadpool_redis::Config::from_url("redis://127.0.0.1:6333")
            .create_pool(Some(deadpool_redis::Runtime::Tokio1))
            .expect("redis pool");

    let s3_client =
        S3Client::new(&aws_config::defaults(BehaviorVersion::latest()).load().await);

    let state = Arc::new(drawrace_api::AppState {
        pool,
        redis: redis_pool,
        s3: s3_client,
        s3_bucket: "test-bucket".into(),
        hmac_config: tokio::sync::RwLock::new(HmacConfig {
            current_key: vec![0u8; 32],
            previous_key: None,
            rotated_at: None,
        }),
        validator_cache: tokio::sync::RwLock::new(
            drawrace_api::handlers::health::CachedValidator {
                physics_version: 0,
                engine_core_wasm_sha256: String::new(),
                ok: false,
                last_success: std::time::Instant::now(),
            },
        ),
        readiness: drawrace_api::handlers::health::ReadinessState {
            has_ever_polled: std::sync::atomic::AtomicBool::new(false),
            boot_instant: std::time::Instant::now(),
        },
    });

    app::app(state)
}

#[tokio::test]
async fn health_returns_200() {
    let app = test_app().await;
    let req = Request::builder()
        .uri("/v1/health")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn ready_returns_200_during_grace_period() {
    let app = test_app().await;
    let req = Request::builder()
        .uri("/v1/health/ready")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn health_response_structure() {
    let app = test_app().await;
    let req = Request::builder()
        .uri("/v1/health")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    let body =
        axum::body::to_bytes(resp.into_body(), 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["api"]["ok"], true);
    assert!(json["api"]["version"].is_string());
    assert!(json["validator"]["physics_version"].is_number());
    assert!(json["validator"]["ok"].is_boolean());
    assert!(json["validator"]["age_seconds"].is_number());
}
