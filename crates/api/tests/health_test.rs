use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use drawrace_api::app;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tower::ServiceExt;

fn test_app() -> Router {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_lazy("postgres://test:test@localhost:5432/drawrace_test")
        .expect("pool");
    let state = Arc::new(drawrace_api::AppState::new(pool));
    app::app(state)
}

#[tokio::test]
async fn health_returns_200() {
    let app = test_app();
    let req = Request::builder()
        .uri("/v1/health")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn ready_returns_200_during_grace_period() {
    let app = test_app();
    let req = Request::builder()
        .uri("/v1/health/ready")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn health_response_structure() {
    let app = test_app();
    let req = Request::builder()
        .uri("/v1/health")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    let body = axum::body::to_bytes(resp.into_body(), 1024)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["api"]["ok"], true);
    assert!(json["api"]["version"].is_string());
    assert!(json["validator"]["physics_version"].is_number());
    assert!(json["validator"]["ok"].is_boolean());
    assert!(json["validator"]["age_seconds"].is_number());
}
