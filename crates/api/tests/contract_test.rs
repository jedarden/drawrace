//! Layer 5 — Backend Contract Tests
//!
//! Exercises the full axum app against real Postgres, Redis, and S3 (MinIO/Garage).
//!
//! Tests that hit the database are marked `#[ignore]` and require infrastructure.
//! Run all tests (unit-only, no infra needed):
//!   cargo test -p drawrace-api --test contract_test
//!
//! Run integration tests (requires Postgres + Redis + S3):
//!   DATABASE_URL=postgres://test:test@localhost:5432/drawrace_test \
//!   REDIS_URL=redis://127.0.0.1:6333 \
//!   S3_ENDPOINT=http://127.0.0.1:9000 \
//!   cargo test -p drawrace-api --test contract_test -- --include-ignored

use aws_config::BehaviorVersion;
use aws_sdk_s3::Client as S3Client;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use drawrace_api::app;
use drawrace_api::blob::{BlobHeader, GhostBlob, HEADER_SIZE};
use drawrace_api::hmac_mod;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

const TEST_HMAC_KEY: [u8; 32] = [0x42u8; 32];
const TEST_PLAYER_UUID: &str = "550e8400-e29b-41d4-a716-446655440000";
const TEST_PLAYER_B_UUID: &str = "660e8400-e29b-41d4-a716-446655440001";

async fn test_app() -> Router {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect_lazy("postgres://test:test@localhost:5432/drawrace_test")
        .expect("pool");

    let redis_pool = deadpool_redis::Config::from_url("redis://127.0.0.1:6333")
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .expect("redis pool");

    let s3_config = {
        let endpoint =
            std::env::var("S3_ENDPOINT").unwrap_or_else(|_| "http://127.0.0.1:9000".into());
        aws_config::defaults(BehaviorVersion::latest())
            .region(aws_sdk_s3::config::Region::new("garage"))
            .endpoint_url(endpoint)
    };
    let s3_client = S3Client::new(&s3_config.load().await);

    let recorder = metrics_exporter_prometheus::PrometheusBuilder::new().build_recorder();
    let metrics_handle = recorder.handle();

    let state = Arc::new(drawrace_api::AppState {
        pool,
        redis: redis_pool,
        s3: s3_client,
        s3_bucket: "test-bucket".into(),
        hmac_config: tokio::sync::RwLock::new(hmac_mod::HmacConfig {
            current_key: TEST_HMAC_KEY.to_vec(),
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
        metrics_handle,
    });

    app::app(state)
}

/// Build a test app with a specific PgPool (for tests that need DB setup/cleanup).
async fn test_app_with_pool(pool: PgPool) -> Router {
    let redis_pool = deadpool_redis::Config::from_url("redis://127.0.0.1:6333")
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .expect("redis pool");

    let s3_config = {
        let endpoint =
            std::env::var("S3_ENDPOINT").unwrap_or_else(|_| "http://127.0.0.1:9000".into());
        aws_config::defaults(BehaviorVersion::latest())
            .region(aws_sdk_s3::config::Region::new("garage"))
            .endpoint_url(endpoint)
    };
    let s3_client = S3Client::new(&s3_config.load().await);

    let recorder = metrics_exporter_prometheus::PrometheusBuilder::new().build_recorder();
    let metrics_handle = recorder.handle();

    let state = Arc::new(drawrace_api::AppState {
        pool,
        redis: redis_pool,
        s3: s3_client,
        s3_bucket: "test-bucket".into(),
        hmac_config: tokio::sync::RwLock::new(hmac_mod::HmacConfig {
            current_key: TEST_HMAC_KEY.to_vec(),
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
        metrics_handle,
    });

    app::app(state)
}

async fn setup_db() -> PgPool {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://test:test@localhost:5432/drawrace_test".into());

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("connect to test database");

    sqlx::query("DELETE FROM submissions")
        .execute(&pool)
        .await
        .ok();
    sqlx::query("DELETE FROM feedback")
        .execute(&pool)
        .await
        .ok();
    sqlx::query("DELETE FROM ghosts").execute(&pool).await.ok();
    sqlx::query("DELETE FROM names").execute(&pool).await.ok();
    sqlx::query("DELETE FROM players").execute(&pool).await.ok();

    pool
}

fn make_test_blob(player_uuid: &str, track_id: u16) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.extend_from_slice(b"DRGH");
    buf.push(2); // version
    buf.extend_from_slice(&track_id.to_le_bytes());
    buf.push(0);
    buf.extend_from_slice(&28441u32.to_le_bytes());
    buf.extend_from_slice(&1745299200000i64.to_le_bytes());
    let uuid = Uuid::parse_str(player_uuid).unwrap();
    buf.extend_from_slice(uuid.as_bytes());

    // wheel_count = 1
    buf.push(1u8);
    // wheel 0: swap_tick = 0
    buf.extend_from_slice(&0u32.to_le_bytes());
    buf.push(12u8); // vertex_count
    for i in 0..12u8 {
        let x = (i as i16) * 10;
        let y = (i as i16) * 20;
        buf.extend_from_slice(&x.to_le_bytes());
        buf.extend_from_slice(&y.to_le_bytes());
    }

    buf.push(5u8);
    for i in 0..5u8 {
        let dx = i as i16;
        let dy = (i as i16) * 2;
        let dt = 16u16;
        buf.extend_from_slice(&dx.to_le_bytes());
        buf.extend_from_slice(&dy.to_le_bytes());
        buf.extend_from_slice(&dt.to_le_bytes());
    }

    buf.push(3u8);
    for i in 0..3u32 {
        buf.extend_from_slice(&(i * 10000).to_le_bytes());
    }

    buf
}

fn make_blob_with_time(player_uuid: &str, track_id: u16, time_ms: u32) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.extend_from_slice(b"DRGH");
    buf.push(2); // version
    buf.extend_from_slice(&track_id.to_le_bytes());
    buf.push(0);
    buf.extend_from_slice(&time_ms.to_le_bytes());
    buf.extend_from_slice(&1745299200000i64.to_le_bytes());
    let uuid = Uuid::parse_str(player_uuid).unwrap();
    buf.extend_from_slice(uuid.as_bytes());

    // wheel_count = 1
    buf.push(1u8);
    // wheel 0: swap_tick = 0
    buf.extend_from_slice(&0u32.to_le_bytes());
    buf.push(12u8); // vertex_count
    for i in 0..12u8 {
        let x = (i as i16) * 10;
        let y = (i as i16) * 20;
        buf.extend_from_slice(&x.to_le_bytes());
        buf.extend_from_slice(&y.to_le_bytes());
    }

    buf.push(5u8);
    for i in 0..5u8 {
        let dx = i as i16;
        let dy = (i as i16) * 2;
        let dt = 16u16;
        buf.extend_from_slice(&dx.to_le_bytes());
        buf.extend_from_slice(&dy.to_le_bytes());
        buf.extend_from_slice(&dt.to_le_bytes());
    }

    buf.push(3u8);
    for i in 0..3u32 {
        buf.extend_from_slice(&(i * 10000).to_le_bytes());
    }

    buf
}

fn compute_hmac(body: &[u8]) -> String {
    let hmac = hmac_mod::compute_hmac(&TEST_HMAC_KEY, body);
    hex::encode(hmac)
}

fn submission_request(
    blob: &[u8],
    player_uuid: &str,
    track_id: u16,
    hmac_hex: &str,
) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", player_uuid)
        .header("X-DrawRace-Track", track_id.to_string())
        .header("X-DrawRace-ClientHMAC", hmac_hex)
        .body(Body::from(blob.to_vec()))
        .unwrap()
}

async fn read_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(resp.into_body(), 65536).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

// ===========================================================================
// 1. Golden request/response: POST /v1/submissions
// ===========================================================================

#[tokio::test]
#[ignore] // requires Postgres + Redis + S3
async fn golden_submission_response_structure() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let hmac = compute_hmac(&body);

    let req = submission_request(&body, TEST_PLAYER_UUID, 1, &hmac);

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::ACCEPTED);

    let json = read_json(resp).await;

    // Assert exactly these three keys exist
    assert_eq!(json.as_object().unwrap().len(), 3);
    assert!(json.get("submission_id").is_some());
    assert!(json.get("status").is_some());
    assert!(json.get("poll_url").is_some());

    assert_eq!(json["status"], "pending_validation");

    // Assert NO extra fields
    assert!(json.get("preliminary_rank").is_none());
    assert!(json.get("preliminary_bucket").is_none());
    assert!(json.get("ghost_id").is_none());
    assert!(json.get("time_ms").is_none());
}

#[tokio::test]
async fn golden_submission_rejects_mismatched_track_header() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let hmac = compute_hmac(&body);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .header("X-DrawRace-Track", "2")
        .header("X-DrawRace-ClientHMAC", hmac)
        .body(Body::from(body))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ===========================================================================
// 2. Poll lifecycle & ownership
// ===========================================================================

#[tokio::test]
#[ignore] // requires Postgres + Redis + S3
async fn poll_returns_400_without_player_header() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let hmac = compute_hmac(&body);

    let post_req = submission_request(&body, TEST_PLAYER_UUID, 1, &hmac);
    let post_resp = app.oneshot(post_req).await.unwrap();
    let post_json = read_json(post_resp).await;
    let submission_id = post_json["submission_id"].as_str().unwrap();

    let app2 = test_app().await;
    let get_req = Request::builder()
        .uri(format!("/v1/submissions/{}", submission_id))
        .body(Body::empty())
        .unwrap();

    let get_resp = app2.oneshot(get_req).await.unwrap();
    assert_eq!(get_resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
#[ignore] // requires Postgres + Redis + S3
async fn poll_returns_200_for_owner_with_pending_status() {
    let pool = setup_db().await;
    let app = test_app_with_pool(pool.clone()).await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let hmac = compute_hmac(&body);

    let post_req = submission_request(&body, TEST_PLAYER_UUID, 1, &hmac);
    let post_resp = app.oneshot(post_req).await.unwrap();
    let post_json = read_json(post_resp).await;
    let submission_id = post_json["submission_id"].as_str().unwrap();

    let app2 = test_app_with_pool(pool).await;
    let get_req = Request::builder()
        .uri(format!("/v1/submissions/{}", submission_id))
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .body(Body::empty())
        .unwrap();

    let get_resp = app2.oneshot(get_req).await.unwrap();
    assert_eq!(get_resp.status(), StatusCode::OK);

    let get_json = read_json(get_resp).await;
    assert_eq!(get_json["status"], "pending_validation");
    assert_eq!(get_json.as_object().unwrap().len(), 1);
}

#[tokio::test]
#[ignore] // requires Postgres + Redis + S3
async fn poll_returns_404_for_different_player_not_403() {
    let pool = setup_db().await;
    let app = test_app_with_pool(pool.clone()).await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let hmac = compute_hmac(&body);

    let post_req = submission_request(&body, TEST_PLAYER_UUID, 1, &hmac);
    let post_resp = app.oneshot(post_req).await.unwrap();
    let post_json = read_json(post_resp).await;
    let submission_id = post_json["submission_id"].as_str().unwrap();

    // Poll with different player B — must be 404 (enumeration-safe), NOT 403
    let app2 = test_app_with_pool(pool).await;
    let get_req = Request::builder()
        .uri(format!("/v1/submissions/{}", submission_id))
        .header("X-DrawRace-Player", TEST_PLAYER_B_UUID)
        .body(Body::empty())
        .unwrap();

    let get_resp = app2.oneshot(get_req).await.unwrap();
    assert_eq!(get_resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
#[ignore] // requires Postgres + Redis + S3
async fn poll_unknown_submission_returns_404() {
    let app = test_app().await;
    let unknown_id = Uuid::new_v4();

    let get_req = Request::builder()
        .uri(format!("/v1/submissions/{}", unknown_id))
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .body(Body::empty())
        .unwrap();

    let get_resp = app.oneshot(get_req).await.unwrap();
    assert_eq!(get_resp.status(), StatusCode::NOT_FOUND);
}

// ===========================================================================
// 3. HMAC roundtrip
// ===========================================================================

#[tokio::test]
#[ignore] // requires Postgres + Redis + S3
async fn hmac_accepts_valid_signature() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let hmac = compute_hmac(&body);

    let req = submission_request(&body, TEST_PLAYER_UUID, 1, &hmac);

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::ACCEPTED);
}

#[tokio::test]
async fn hmac_rejects_flipped_byte_in_mac() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);

    let valid_hmac = compute_hmac(&body);
    let mut hmac_bytes = hex::decode(&valid_hmac).unwrap();
    hmac_bytes[0] ^= 0xFF;
    let corrupted_hmac = hex::encode(&hmac_bytes);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .header("X-DrawRace-Track", "1")
        .header("X-DrawRace-ClientHMAC", corrupted_hmac)
        .body(Body::from(body))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    // Must be 400 (malformed request), NOT 401 (unauthorized)
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let json = read_json(resp).await;
    assert!(json["error"].as_str().unwrap().contains("HMAC"));
}

#[tokio::test]
#[ignore] // requires Postgres + Redis + S3
async fn hmac_rejects_flipped_byte_in_body() {
    let app = test_app().await;
    let original_body = make_test_blob(TEST_PLAYER_UUID, 1);

    // Sign the original body
    let hmac = compute_hmac(&original_body);

    // Send a body with one byte flipped (after header fields we validate)
    let mut corrupted_body = original_body.clone();
    let flip_offset = drawrace_api::blob::HEADER_SIZE + 10;
    if flip_offset < corrupted_body.len() {
        corrupted_body[flip_offset] ^= 0xFF;
    }

    let req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .header("X-DrawRace-Track", "1")
        .header("X-DrawRace-ClientHMAC", hmac)
        .body(Body::from(corrupted_body))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn hmac_rejects_invalid_hex() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .header("X-DrawRace-Track", "1")
        .header("X-DrawRace-ClientHMAC", "not-valid-hex!!")
        .body(Body::from(body))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn hmac_rejects_missing_hmac_header() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .header("X-DrawRace-Track", "1")
        .body(Body::from(body))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
#[ignore] // requires Postgres + Redis + S3
async fn hmac_rejects_wrong_key() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);

    let wrong_key = [0xABu8; 32];
    let hmac = hex::encode(hmac_mod::compute_hmac(&wrong_key, &body));

    let req = submission_request(&body, TEST_PLAYER_UUID, 1, &hmac);

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ===========================================================================
// 4. Ghost integrity roundtrip (blob format verification)
// ===========================================================================

#[tokio::test]
async fn ghost_blob_parse_roundtrip() {
    let body = make_test_blob(TEST_PLAYER_UUID, 1);

    let header = BlobHeader::parse(&body).unwrap();
    assert_eq!(header.track_id, 1);
    assert_eq!(header.version, 2);
    assert_eq!(header.player_uuid.to_string(), TEST_PLAYER_UUID);

    let ghost = GhostBlob::parse(&body).unwrap();
    assert_eq!(ghost.wheel_count, 1);
    assert_eq!(ghost.wheels[0].vertex_count, 12);
    assert_eq!(ghost.wheels[0].polygon_vertices.len(), 12);
    assert_eq!(ghost.point_count, 5);
    assert_eq!(ghost.stroke_points.len(), 5);
    assert_eq!(ghost.checkpoint_count, 3);
    assert_eq!(ghost.checkpoint_splits.len(), 3);
}

#[test]
fn blob_header_roundtrip_preserves_fields() {
    let player_uuid = Uuid::new_v4();
    let time_ms = 28441u32;
    let track_id = 1u16;
    let blob = make_test_blob(&player_uuid.to_string(), track_id);

    let header = BlobHeader::parse(&blob).unwrap();
    assert_eq!(header.version, 2);
    assert_eq!(header.track_id, track_id);
    assert_eq!(header.finish_time_ms, time_ms);
    assert_eq!(header.player_uuid, player_uuid);
}

#[test]
fn blob_parse_is_deterministic() {
    let blob = make_test_blob(TEST_PLAYER_UUID, 1);
    let p1 = GhostBlob::parse(&blob).unwrap();
    let p2 = GhostBlob::parse(&blob).unwrap();

    assert_eq!(p1.wheel_count, p2.wheel_count);
    assert_eq!(p1.wheels.len(), p2.wheels.len());
    for (w1, w2) in p1.wheels.iter().zip(p2.wheels.iter()) {
        assert_eq!(w1.swap_tick, w2.swap_tick);
        assert_eq!(w1.vertex_count, w2.vertex_count);
        assert_eq!(w1.polygon_vertices, w2.polygon_vertices);
    }
    assert_eq!(p1.point_count, p2.point_count);
    assert_eq!(p1.stroke_points, p2.stroke_points);
    assert_eq!(p1.checkpoint_count, p2.checkpoint_count);
    assert_eq!(p1.checkpoint_splits, p2.checkpoint_splits);
}

#[test]
fn blob_with_custom_time_roundtrips() {
    let player_uuid = Uuid::new_v4();
    let blob = make_blob_with_time(&player_uuid.to_string(), 1, 50000);

    let header = BlobHeader::parse(&blob).unwrap();
    assert_eq!(header.finish_time_ms, 50000);

    let ghost = GhostBlob::parse(&blob).unwrap();
    assert_eq!(ghost.wheel_count, 1);
    assert_eq!(ghost.wheels[0].vertex_count, 12);
    assert_eq!(ghost.point_count, 5);
}

// ===========================================================================
// 5. Bucket assignment (via direct SQL seeding)
// ===========================================================================

#[tokio::test]
#[ignore] // requires Postgres
async fn bucket_assignment_from_seeded_times() {
    let pool = setup_db().await;

    // Seed 100 players + ghosts directly into the DB
    for i in 1..=100 {
        let player_uuid = Uuid::new_v4();
        sqlx::query("INSERT INTO players (player_uuid) VALUES ($1) ON CONFLICT DO NOTHING")
            .bind(player_uuid)
            .execute(&pool)
            .await
            .unwrap();

        let time_ms = 20000 + i * 100; // 20100..30000
        let s3_key = format!("ghosts/1/{}/seed-{}.bin", player_uuid, i);
        sqlx::query(
            "INSERT INTO ghosts (ghost_id, player_uuid, track_id, physics_version, time_ms, is_pb, is_legacy, s3_key)
             VALUES ($1, $2, 1, 1, $3, true, false, $4)"
        )
        .bind(Uuid::new_v4())
        .bind(player_uuid)
        .bind(time_ms)
        .bind(&s3_key)
        .execute(&pool)
        .await
        .unwrap();
    }

    // Refresh the materialized view
    sqlx::query("REFRESH MATERIALIZED VIEW leaderboard_buckets")
        .execute(&pool)
        .await
        .unwrap();

    // Verify rank boundaries match the bucket_for_rank logic:
    // rank 1 → elite, 2-5 → advanced, 6-20 → skilled, 21-50 → mid, 51+ → novice

    // Fastest ghost (time 20100): rank 1 = elite
    let count_better: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ghosts WHERE track_id = 1 AND is_pb = true AND time_ms < 20100",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count_better, 0, "no ghosts faster than 20100");
    assert_eq!(count_better + 1, 1); // elite

    // Time 20500: rank 2-5 = advanced
    let count_20500: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ghosts WHERE track_id = 1 AND is_pb = true AND time_ms < 20500",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let rank_20500 = count_20500 + 1;
    assert!(
        (2..=5).contains(&rank_20500),
        "rank {} should be advanced (2-5)",
        rank_20500
    );

    // Time 25000: rank 6-20 = skilled
    let count_25000: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ghosts WHERE track_id = 1 AND is_pb = true AND time_ms < 25000",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let rank_25000 = count_25000 + 1;
    assert!(
        (6..=20).contains(&rank_25000),
        "rank {} should be skilled (6-20)",
        rank_25000
    );

    // Time 29000: rank > 20 = mid or novice
    let count_29000: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ghosts WHERE track_id = 1 AND is_pb = true AND time_ms < 29000",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let rank_29000 = count_29000 + 1;
    assert!(rank_29000 > 20, "rank {} should be mid+ (>20)", rank_29000);
}

// ===========================================================================
// 6. Matchmake empty-bucket fallback
// ===========================================================================

#[tokio::test]
async fn matchmake_rejects_missing_player_uuid() {
    let app = test_app().await;

    let req = Request::builder()
        .uri("/v1/matchmake/1")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert!(matches!(
        resp.status(),
        StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY
    ));
}

#[tokio::test]
async fn matchmake_response_structure_serialization() {
    use drawrace_api::handlers::matchmake::{MatchmakeGhost, MatchmakeResponse};

    let response = MatchmakeResponse {
        track_id: 1,
        player_bucket: "novice".into(),
        target_bucket: "mid".into(),
        ghosts: vec![MatchmakeGhost {
            ghost_id: Uuid::new_v4(),
            time_ms: 30000,
            name: "TestPlayer".into(),
            url: "https://example.com/ghost.bin".into(),
        }],
        shadow_ghost: None,
        expires_at: chrono::Utc::now().to_rfc3339(),
    };

    let json = serde_json::to_value(&response).unwrap();
    let obj = json.as_object().unwrap();

    assert!(obj.get("track_id").is_some());
    assert!(obj.get("player_bucket").is_some());
    assert!(obj.get("target_bucket").is_some());
    assert!(obj.get("ghosts").is_some());
    assert!(obj.get("shadow_ghost").is_some());
    assert!(obj.get("expires_at").is_some());
}

#[tokio::test]
async fn matchmake_ghost_structure_serialization() {
    use drawrace_api::handlers::matchmake::MatchmakeGhost;

    let ghost = MatchmakeGhost {
        ghost_id: Uuid::new_v4(),
        time_ms: 28441,
        name: "TestPlayer".into(),
        url: "https://example.com/ghost.bin".into(),
    };

    let json = serde_json::to_value(&ghost).unwrap();
    let obj = json.as_object().unwrap();

    assert_eq!(obj.len(), 4);
    assert!(obj.get("ghost_id").is_some());
    assert!(obj.get("time_ms").is_some());
    assert!(obj.get("name").is_some());
    assert!(obj.get("url").is_some());
}

// ===========================================================================
// Blob validation edge cases
// ===========================================================================

#[tokio::test]
async fn submission_rejects_blob_too_short() {
    let app = test_app().await;
    let tiny_blob = vec![0u8; 10];
    let hmac = compute_hmac(&tiny_blob);

    let req = submission_request(&tiny_blob, TEST_PLAYER_UUID, 1, &hmac);

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn submission_rejects_invalid_magic() {
    let app = test_app().await;
    let mut body = make_test_blob(TEST_PLAYER_UUID, 1);
    body[0] = b'X';
    let hmac = compute_hmac(&body);

    let req = submission_request(&body, TEST_PLAYER_UUID, 1, &hmac);

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn submission_rejects_mismatched_player_uuid() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let hmac = compute_hmac(&body);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_B_UUID)
        .header("X-DrawRace-Track", "1")
        .header("X-DrawRace-ClientHMAC", hmac)
        .body(Body::from(body))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn submission_rejects_missing_player_header() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let hmac = compute_hmac(&body);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Track", "1")
        .header("X-DrawRace-ClientHMAC", hmac)
        .body(Body::from(body))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn submission_rejects_invalid_player_uuid() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let hmac = compute_hmac(&body);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", "not-a-uuid")
        .header("X-DrawRace-Track", "1")
        .header("X-DrawRace-ClientHMAC", hmac)
        .body(Body::from(body))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn submission_rejects_missing_track_header() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let hmac = compute_hmac(&body);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .header("X-DrawRace-ClientHMAC", hmac)
        .body(Body::from(body))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn submission_rejects_invalid_track_id() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let hmac = compute_hmac(&body);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .header("X-DrawRace-Track", "not-a-number")
        .header("X-DrawRace-ClientHMAC", hmac)
        .body(Body::from(body))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ===========================================================================
// Verdict structure contract tests
// ===========================================================================

#[tokio::test]
async fn accepted_verdict_includes_bucket_field() {
    use drawrace_api::handlers::submissions::SubmissionAcceptedVerdict;

    let verdict = SubmissionAcceptedVerdict {
        status: "accepted",
        ghost_id: Uuid::new_v4().to_string(),
        time_ms: 28441,
        rank: 5,
        bucket: "advanced".into(),
        is_pb: true,
    };

    let json = serde_json::to_value(&verdict).unwrap();
    let obj = json.as_object().unwrap();

    assert_eq!(obj.len(), 6);
    assert!(obj.get("status").is_some());
    assert!(obj.get("ghost_id").is_some());
    assert!(obj.get("time_ms").is_some());
    assert!(obj.get("rank").is_some());
    assert!(obj.get("bucket").is_some());
    assert!(obj.get("is_pb").is_some());
}

#[tokio::test]
async fn rejected_verdict_has_exact_fields() {
    use drawrace_api::handlers::submissions::SubmissionRejectedVerdict;

    let verdict = SubmissionRejectedVerdict {
        status: "rejected",
        reason: "physics_mismatch".into(),
    };

    let json = serde_json::to_value(&verdict).unwrap();
    let obj = json.as_object().unwrap();

    assert_eq!(obj.len(), 2);
    assert!(obj.get("status").is_some());
    assert!(obj.get("reason").is_some());
}

// ===========================================================================
// Submission persistence contract
// ===========================================================================

#[tokio::test]
#[ignore] // requires Postgres + Redis + S3
async fn submission_creates_player_and_persists() {
    let pool = setup_db().await;
    let app = test_app_with_pool(pool.clone()).await;

    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let hmac = compute_hmac(&body);
    let req = submission_request(&body, TEST_PLAYER_UUID, 1, &hmac);

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::ACCEPTED);
    let json = read_json(resp).await;
    let submission_id = json["submission_id"].as_str().unwrap();

    // Player was lazily registered
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM players WHERE player_uuid = $1)")
            .bind(Uuid::parse_str(TEST_PLAYER_UUID).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(exists);

    // Submission row exists
    let row: Option<(String,)> =
        sqlx::query_as("SELECT status FROM submissions WHERE submission_id = $1")
            .bind(Uuid::parse_str(submission_id).unwrap())
            .fetch_optional(&pool)
            .await
            .unwrap();
    assert!(row.is_some());
    assert_eq!(row.unwrap().0, "pending_validation");
}

// ===========================================================================
// 7. Ephemeral submission (flags bit 0x02)
// ===========================================================================

#[tokio::test]
async fn ephemeral_submission_returns_204() {
    let app = test_app().await;
    let mut body = make_test_blob(TEST_PLAYER_UUID, 1);
    body[7] = 0x02; // set ephemeral flag
    let hmac = compute_hmac(&body);

    let req = submission_request(&body, TEST_PLAYER_UUID, 1, &hmac);

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn ephemeral_submission_rejects_malformed_blob() {
    let app = test_app().await;
    let mut body = make_test_blob(TEST_PLAYER_UUID, 1);
    body[7] = 0x02; // set ephemeral flag
    body.truncate(HEADER_SIZE + 1 + 10); // not enough polygon data
    let hmac = compute_hmac(&body);

    let req = submission_request(&body, TEST_PLAYER_UUID, 1, &hmac);

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
#[ignore] // requires Postgres + Redis + S3
async fn ephemeral_submission_leaves_db_untouched() {
    let pool = setup_db().await;
    let app = test_app_with_pool(pool.clone()).await;

    let mut body = make_test_blob(TEST_PLAYER_UUID, 1);
    body[7] = 0x02; // set ephemeral flag
    let hmac = compute_hmac(&body);

    let req = submission_request(&body, TEST_PLAYER_UUID, 1, &hmac);

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // No rows in any table
    let ghost_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ghosts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(ghost_count, 0);

    let sub_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM submissions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sub_count, 0);

    let player_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM players WHERE player_uuid = $1")
            .bind(Uuid::parse_str(TEST_PLAYER_UUID).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(player_count, 0);
}

// ===========================================================================
// 8. Crash report endpoint
// ===========================================================================

#[tokio::test]
async fn crash_report_rejects_empty_message() {
    let app = test_app().await;
    let req = Request::builder()
        .method("POST")
        .uri("/v1/crash")
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{"message":""}#))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn crash_report_rejects_missing_body() {
    let app = test_app().await;
    let req = Request::builder()
        .method("POST")
        .uri("/v1/crash")
        .header("content-type", "application/json")
        .body(Body::from(r#"{}"#,
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    // Empty-string message triggers the handler's 400 check, not a JSON deserialization error
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ===========================================================================
// 9. Invite code endpoint
// ===========================================================================

#[tokio::test]
async fn invite_redeem_rejects_empty_code() {
    let app = test_app().await;
    let req = Request::builder()
        .method("POST")
        .uri("/v1/invites/redeem")
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{"code":"","player_uuid":"550e8400-e29b-41d4-a716-446655440000"}"#,
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn invite_status_returns_false_without_player_header() {
    let app = test_app().await;
    let req = Request::builder()
        .uri("/v1/invites/status")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let json = read_json(resp).await;
    assert_eq!(json["has_access"], false);
}
