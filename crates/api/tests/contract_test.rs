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
use axum::extract::connect_info::MockConnectInfo;
use axum::http::{Request, StatusCode};
use axum::Router;
use drawrace_api::app;
use drawrace_api::blob::{BlobHeader, GhostBlob, HEADER_SIZE};
use drawrace_api::handlers::submissions::{
    POLL_RATE_LIMIT_MAX, POLL_RATE_LIMIT_WINDOW_SECS, SUBMIT_RATE_LIMIT_MAX,
    SUBMIT_RATE_LIMIT_PER_IP_MAX, SUBMIT_RATE_LIMIT_WINDOW_SECS,
};
use drawrace_api::hmac_mod;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::net::SocketAddr;
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

const TEST_HMAC_KEY: [u8; 32] = [0x42u8; 32];
const TEST_PLAYER_UUID: &str = "550e8400-e29b-41d4-a716-446655440000";
const TEST_PLAYER_B_UUID: &str = "660e8400-e29b-41d4-a716-446655440001";

/// Build the shared [`drawrace_api::AppState`] used by the contract suite,
/// against a given Postgres pool. Redis/S3/HMAC config are identical for every
/// test, so this avoids duplicating ~50 lines between [`test_app`] and
/// [`test_app_with_pool`].
async fn make_state(pool: PgPool) -> Arc<drawrace_api::AppState> {
    // Inert by default — mirrors production (non-staging). Tests that need the
    // bypass active build state via `make_state_with_bypass`.
    make_state_with_bypass(pool, drawrace_api::rate_limit_bypass::RateLimitBypass::empty()).await
}

/// Like [`make_state`], but with an explicit per-IP rate-limit bypass
/// allowlist injected. Used by the bypass contract tests (section 13) to drive
/// `post_submission`'s staging-only bypass path without touching the process
/// environment.
async fn make_state_with_bypass(
    pool: PgPool,
    rate_limit_bypass: drawrace_api::rate_limit_bypass::RateLimitBypass,
) -> Arc<drawrace_api::AppState> {
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

    Arc::new(drawrace_api::AppState {
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
                physics_version: 2,
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
        rate_limit_bypass,
    })
}

/// Default loopback TCP peer injected via [`MockConnectInfo`] for the
/// `oneshot`-based tests. The real server uses
/// `into_make_service_with_connect_info` (see `main.rs`), which inserts the
/// actual TCP peer into each request's extensions; under `oneshot` there is no
/// socket, so we mock it. `post_submission` reads this via `ip::peer_ip`.
const TEST_PEER: ([u8; 4], u16) = ([127, 0, 0, 1], 0);

async fn test_app() -> Router {
    test_app_with_peer(TEST_PEER.into()).await
}

/// Build a test app whose `post_submission` handler observes a specific TCP
/// peer address. Used by the per-IP rate-limit test to isolate its counter
/// (a distinct loopback IP) from the shared `TEST_PEER` the rest of the suite
/// writes to — otherwise this test's 200+ requests would trip the per-UUID
/// test's shared per-IP counter when the ignored suite runs in parallel.
async fn test_app_with_peer(peer: SocketAddr) -> Router {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect_lazy("postgres://test:test@localhost:5432/drawrace_test")
        .expect("pool");
    app::app(make_state(pool).await).layer(MockConnectInfo(peer))
}

/// Like [`test_app_with_peer`], but injects a specific per-IP rate-limit
/// bypass allowlist into the app state. Used by the bypass tests (section 13)
/// to exercise the staging-only bypass path against a chosen TCP peer.
async fn test_app_with_bypass_peer(
    peer: SocketAddr,
    bypass: drawrace_api::rate_limit_bypass::RateLimitBypass,
) -> Router {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect_lazy("postgres://test:test@localhost:5432/drawrace_test")
        .expect("pool");
    app::app(make_state_with_bypass(pool, bypass).await).layer(MockConnectInfo(peer))
}

/// Build a test app with a specific PgPool (for tests that need DB setup/cleanup).
async fn test_app_with_pool(pool: PgPool) -> Router {
    app::app(make_state(pool).await).layer(MockConnectInfo(SocketAddr::from(TEST_PEER)))
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
    make_blob_with_version_time(player_uuid, track_id, 2, time_ms)
}

fn make_blob_with_version_time(
    player_uuid: &str,
    track_id: u16,
    version: u8,
    time_ms: u32,
) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.extend_from_slice(b"DRGH");
    buf.push(version); // physics_version
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

#[tokio::test]
async fn golden_submission_rejects_physics_version_mismatch() {
    // Create an app with validator physics_version = 4
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
                physics_version: 4, // Current validator physics_version
                engine_core_wasm_sha256: String::new(),
                ok: true,
                last_success: std::time::Instant::now(),
            },
        ),
        readiness: drawrace_api::handlers::health::ReadinessState {
            has_ever_polled: std::sync::atomic::AtomicBool::new(true),
            boot_instant: std::time::Instant::now(),
        },
        metrics_handle,
        // Mirrors production: an inert (empty) bypass. This test asserts the
        // 409 physics-version-mismatch path, which runs before rate limiting, so
        // the bypass value is irrelevant here — but the field is required.
        rate_limit_bypass: drawrace_api::rate_limit_bypass::RateLimitBypass::empty(),
    });

    // post_submission now requires `ConnectInfo<SocketAddr>` (it reads the TCP
    // peer for per-IP rate limiting via `ip::peer_ip`). There is no socket
    // under `oneshot`, so mock the peer the same way `test_app` does.
    let app = app::app(state).layer(MockConnectInfo(SocketAddr::from(TEST_PEER)));

    // Create a blob with physics_version = 3 (stale client)
    let body = make_blob_with_version_time(TEST_PLAYER_UUID, 1, 3, 28441);
    let hmac = compute_hmac(&body);

    let req = submission_request(&body, TEST_PLAYER_UUID, 1, &hmac);
    let resp = app.oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::CONFLICT);

    let json = read_json(resp).await;
    assert_eq!(json["error"], "PHYSICS_VERSION_MISMATCH");
    assert_eq!(json["expected"], 4);
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

// ===========================================================================
// 10. Per-UUID submission rate limit (20/min → 429 + Retry-After)
// ===========================================================================

#[tokio::test]
#[ignore] // requires Redis (Postgres optional: first 20 return 202 with it)
async fn submission_rate_limit_21st_returns_429_with_retry_after() {
    let app = test_app().await;
    // Fresh UUID so the per-UUID counter starts at zero.
    let player_uuid = Uuid::new_v4().to_string();
    let body = make_test_blob(&player_uuid, 1);
    let hmac = compute_hmac(&body);

    // The first 20 submissions from this player must pass the rate limit
    // (NOT return 429). Their final status depends on whether Postgres/S3 are
    // reachable (202 with them, 500 without) — we only assert none are
    // rate-limited, which proves the counter is only enforced above 20.
    for i in 0..20 {
        let req = submission_request(&body, &player_uuid, 1, &hmac);
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_ne!(
            resp.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "submission #{} within the 20/min window must not be rate-limited",
            i + 1,
        );
    }

    // The 21st submission within the 60s window → 429 Too Many Requests.
    let req = submission_request(&body, &player_uuid, 1, &hmac);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);

    // Retry-After must be present and parse as a positive integer of seconds
    // not exceeding the 60s window.
    let retry_after = resp
        .headers()
        .get("retry-after")
        .expect("429 must carry a Retry-After header");
    let secs: i64 = retry_after
        .to_str()
        .unwrap()
        .parse()
        .expect("Retry-After must be a parseable integer of seconds");
    assert!(secs > 0, "Retry-After must be positive, got {}", secs);
    assert!(
        secs <= 60,
        "Retry-After must not exceed the 60s window, got {}",
        secs
    );

    // A different player is unaffected — their first submission is not limited.
    let other_uuid = Uuid::new_v4().to_string();
    let other_body = make_test_blob(&other_uuid, 1);
    let other_hmac = compute_hmac(&other_body);
    let req = submission_request(&other_body, &other_uuid, 1, &other_hmac);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_ne!(
        resp.status(),
        StatusCode::TOO_MANY_REQUESTS,
        "a different player_uuid must have its own budget"
    );
}

// ===========================================================================
// 11. Per-IP submission rate limit (200/min → 429 + Retry-After)
// ===========================================================================

/// A loopback IP *distinct* from [`TEST_PEER`] so the 200+ requests this test
/// fires never share the `rl:submit:ip:127.0.0.1` counter the rest of the
/// ignored suite (including the per-UUID test above) writes to.
const PER_IP_TEST_PEER: ([u8; 4], u16) = ([127, 0, 0, 2], 0);

/// Over the per-IP ceiling from one address returns 429 + Retry-After even
/// across many distinct UUIDs, and the keyed IP is the real TCP peer (NOT
/// `X-Forwarded-For`).
#[tokio::test]
#[ignore] // requires Redis (Postgres/S3 optional: under-limit requests may 500)
async fn submission_per_ip_rate_limit_trips_across_many_uuids() {
    // Distinct IP from TEST_PEER → isolated per-IP counter.
    let app = test_app_with_peer(PER_IP_TEST_PEER.into()).await;

    // Each request uses a FRESH player UUID (so the per-UUID counter never
    // reaches its 20/min ceiling — only the per-IP limiter can trip) but the
    // SAME TCP peer. We also set a unique `X-Forwarded-For` per request:
    // because the rate-limit key is the TCP peer (ip::peer_ip) and NOT the
    // forwarded header (plan §Multiplayer & Backend 1), every request
    // increments the SAME per-IP key. If the limiter trusted XFF, each request
    // would hash to a unique key and the cap could never trip.
    for i in 0..SUBMIT_RATE_LIMIT_PER_IP_MAX {
        let uuid = Uuid::new_v4().to_string();
        let body = make_test_blob(&uuid, 1);
        let hmac = compute_hmac(&body);
        let req = Request::builder()
            .method("POST")
            .uri("/v1/submissions")
            .header("X-DrawRace-Player", &uuid)
            .header("X-DrawRace-Track", "1")
            .header("X-DrawRace-ClientHMAC", &hmac)
            // Spoofed forwarded header — must NOT influence the keyed IP.
            .header(
                "X-Forwarded-For",
                format!("203.0.113.{}", (i % 254) as u32 + 1),
            )
            .body(Body::from(body))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_ne!(
            resp.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "per-IP request {}/{} (fresh UUID) must pass while under the {}/min ceiling",
            i + 1,
            SUBMIT_RATE_LIMIT_PER_IP_MAX,
            SUBMIT_RATE_LIMIT_PER_IP_MAX,
        );
    }

    // The 201st submission from the SAME TCP peer — fresh UUID (under its own
    // 20/min budget), carrying yet another spoofed XFF — trips ONLY the per-IP
    // ceiling → 429 + Retry-After.
    let uuid = Uuid::new_v4().to_string();
    let body = make_test_blob(&uuid, 1);
    let hmac = compute_hmac(&body);
    let req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", &uuid)
        .header("X-DrawRace-Track", "1")
        .header("X-DrawRace-ClientHMAC", &hmac)
        .header("X-Forwarded-For", "203.0.113.42")
        .body(Body::from(body))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);

    let retry_after = resp
        .headers()
        .get("retry-after")
        .expect("per-IP 429 must carry a Retry-After header");
    let secs: i64 = retry_after
        .to_str()
        .unwrap()
        .parse()
        .expect("Retry-After must be a parseable integer of seconds");
    assert!(secs > 0, "Retry-After must be positive, got {}", secs);
    assert!(
        secs <= SUBMIT_RATE_LIMIT_WINDOW_SECS,
        "Retry-After must not exceed the {}s window, got {}",
        SUBMIT_RATE_LIMIT_WINDOW_SECS,
        secs
    );

    // The SAME number of requests from a *different* TCP peer are unaffected:
    // the limit is keyed per-IP, so a second source has its own budget. (Uses
    // a third loopback IP, isolated from both counters above.)
    let other_app = test_app_with_peer(([127, 0, 0, 3], 0).into()).await;
    let other_uuid = Uuid::new_v4().to_string();
    let other_body = make_test_blob(&other_uuid, 1);
    let other_hmac = compute_hmac(&other_body);
    let req = submission_request(&other_body, &other_uuid, 1, &other_hmac);
    let resp = other_app.oneshot(req).await.unwrap();
    assert_ne!(
        resp.status(),
        StatusCode::TOO_MANY_REQUESTS,
        "a different TCP peer address must have its own per-IP budget"
    );
}

// ===========================================================================
// 12. Per-UUID poll rate limit (60/min → 429 + Retry-After)
// ===========================================================================

#[tokio::test]
#[ignore] // requires Redis (Postgres optional: under-limit polls may 500)
async fn poll_rate_limit_61st_returns_429_with_retry_after() {
    let app = test_app().await;
    // Fresh UUID so the per-UUID poll counter starts at zero.
    let player_uuid = Uuid::new_v4().to_string();
    // An unknown submission id: under-limit polls pass the limiter and fall
    // through to normal handling (404 not-found with Postgres/Redis, 500
    // without) — which is itself the expected poll body for a missing row.
    let unknown_id = Uuid::new_v4();

    // The first 60 polls from this player must pass the rate limit (NOT 429).
    // Their final status depends on whether Postgres/Redis-inflight are
    // reachable (404 with them, 500 without) — we only assert none are
    // rate-limited, which proves the counter is only enforced above 60 and
    // under-limit polls pass through to normal handling.
    for i in 0..POLL_RATE_LIMIT_MAX {
        let req = Request::builder()
            .uri(format!("/v1/submissions/{}", unknown_id))
            .header("X-DrawRace-Player", &player_uuid)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_ne!(
            resp.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "poll #{} within the 60/min window must not be rate-limited",
            i + 1,
        );
    }

    // The 61st poll within the 60s window → 429 Too Many Requests.
    let req = Request::builder()
        .uri(format!("/v1/submissions/{}", unknown_id))
        .header("X-DrawRace-Player", &player_uuid)
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);

    // Retry-After must be present and parse as a positive integer of seconds
    // not exceeding the 60s window.
    let retry_after = resp
        .headers()
        .get("retry-after")
        .expect("429 must carry a Retry-After header");
    let secs: i64 = retry_after
        .to_str()
        .unwrap()
        .parse()
        .expect("Retry-After must be a parseable integer of seconds");
    assert!(secs > 0, "Retry-After must be positive, got {}", secs);
    assert!(
        secs <= POLL_RATE_LIMIT_WINDOW_SECS,
        "Retry-After must not exceed the {}s window, got {}",
        POLL_RATE_LIMIT_WINDOW_SECS,
        secs
    );

    // A different player is unaffected — their first poll is not limited.
    let other_uuid = Uuid::new_v4().to_string();
    let req = Request::builder()
        .uri(format!("/v1/submissions/{}", unknown_id))
        .header("X-DrawRace-Player", &other_uuid)
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_ne!(
        resp.status(),
        StatusCode::TOO_MANY_REQUESTS,
        "a different player_uuid must have its own poll budget"
    );
}

// ===========================================================================
// 13. Staging-only per-IP rate-limit bypass (DRAWRACE_RATE_LIMIT_BYPASS_CIDR)
// ===========================================================================
//
// Plan §Multiplayer & Backend 8 Layer 2: in staging only, an allowlist of CIDRs
// lets matching TCP peers skip the per-IP submission limit (so the k6 runner
// can ramp to 2000 RPS without self-tripping). The bypass is inert in every
// non-staging deployment and affects per-IP only — per-UUID limits still apply.
// These tests build the bypass via `from_env` to exercise the staging gate
// end-to-end through `post_submission`'s guard.

/// A TEST-NET-2 (198.51.100.0/24) peer used by all three bypass tests. It is
/// inside the bypass CIDR when active and keeps these tests' per-IP counters
/// isolated from the loopback keys the rest of the suite writes. Each test uses
/// a distinct last octet so its per-IP counter never collides with another's.
const BYPASS_CIDR: &str = "198.51.100.0/24";

/// Acceptance criterion 1 — bypass ACTIVE in staging: with `DRAWRACE_ENV` ==
/// "staging" and the source IP inside the bypass list, the per-IP limit is
/// skipped, so requests beyond the per-IP ceiling are NOT rate-limited.
#[tokio::test]
#[ignore] // requires Redis (Postgres optional: under-limit requests may 500)
async fn bypass_active_in_staging_skips_per_ip_limit() {
    // staging + matching CIDR → non-empty allowlist that contains the peer.
    let bypass = drawrace_api::rate_limit_bypass::RateLimitBypass::from_env(
        Some("staging".into()),
        Some(BYPASS_CIDR.into()),
    );
    assert!(!bypass.is_empty(), "staging + CIDR must populate the allowlist");
    let peer: SocketAddr = ([198, 51, 100, 9], 0).into();
    assert!(bypass.should_bypass(&peer.ip()));

    let app = test_app_with_bypass_peer(peer, bypass).await;

    // Fire BEYOND the per-IP ceiling, each from a FRESH UUID (so the per-UUID
    // counter never reaches its 20/min ceiling — only the per-IP limiter could
    // trip). With the bypass active none of these are 429; without it the very
    // first over-ceiling request would be. Under-limit requests may 500 when
    // Postgres/S3 are absent — that is fine, we only assert no 429.
    for i in 0..(SUBMIT_RATE_LIMIT_PER_IP_MAX + 5) {
        let uuid = Uuid::new_v4().to_string();
        let body = make_test_blob(&uuid, 1);
        let hmac = compute_hmac(&body);
        let req = submission_request(&body, &uuid, 1, &hmac);
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_ne!(
            resp.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "bypassed per-IP request {}/{} in staging must NOT be rate-limited",
            i + 1,
            SUBMIT_RATE_LIMIT_PER_IP_MAX + 5,
        );
    }
}

/// Acceptance criterion 2 — bypass INERT in production: even with the CIDR var
/// set AND the source IP inside it, `DRAWRACE_ENV=production` makes the bypass
/// a no-op, so the per-IP limit still trips over the ceiling.
#[tokio::test]
#[ignore] // requires Redis (Postgres optional: under-limit requests may 500)
async fn bypass_inert_in_production_still_trips_per_ip() {
    // production + matching CIDR → empty allowlist (the CIDR var is ignored).
    let bypass = drawrace_api::rate_limit_bypass::RateLimitBypass::from_env(
        Some("production".into()),
        Some(BYPASS_CIDR.into()),
    );
    assert!(bypass.is_empty(), "production must yield an empty allowlist");
    let peer: SocketAddr = ([198, 51, 100, 10], 0).into();

    let app = test_app_with_bypass_peer(peer, bypass).await;

    // The first PER_IP_MAX requests (fresh UUID each, so per-UUID never trips)
    // pass the per-IP limit.
    for i in 0..SUBMIT_RATE_LIMIT_PER_IP_MAX {
        let uuid = Uuid::new_v4().to_string();
        let body = make_test_blob(&uuid, 1);
        let hmac = compute_hmac(&body);
        let req = submission_request(&body, &uuid, 1, &hmac);
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_ne!(
            resp.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "per-IP request {}/{} under the ceiling must not be rate-limited",
            i + 1,
            SUBMIT_RATE_LIMIT_PER_IP_MAX,
        );
    }

    // The (PER_IP_MAX + 1)th from the same peer — fresh UUID, so only the
    // per-IP limiter can trip — returns 429. Proves production makes the bypass
    // inert even though the IP is inside the (ignored) CIDR.
    let uuid = Uuid::new_v4().to_string();
    let body = make_test_blob(&uuid, 1);
    let hmac = compute_hmac(&body);
    let req = submission_request(&body, &uuid, 1, &hmac);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);

    let retry_after = resp
        .headers()
        .get("retry-after")
        .expect("per-IP 429 must carry a Retry-After header");
    let secs: i64 = retry_after
        .to_str()
        .unwrap()
        .parse()
        .expect("Retry-After must be a parseable integer of seconds");
    assert!(secs > 0, "Retry-After must be positive, got {}", secs);
    assert!(
        secs <= SUBMIT_RATE_LIMIT_WINDOW_SECS,
        "Retry-After must not exceed the {}s window, got {}",
        SUBMIT_RATE_LIMIT_WINDOW_SECS,
        secs
    );
}

/// Acceptance criterion 3 — bypass affects per-IP ONLY: even with the bypass
/// active and the source IP inside it, the per-UUID submission limit still
/// fires. With the bypass in place the per-IP limiter cannot trip, so the only
/// thing that can produce a 429 here is the per-UUID ceiling.
#[tokio::test]
#[ignore] // requires Redis (Postgres optional: under-limit requests may 500)
async fn bypass_does_not_skip_per_uuid_limit() {
    let bypass = drawrace_api::rate_limit_bypass::RateLimitBypass::from_env(
        Some("staging".into()),
        Some(BYPASS_CIDR.into()),
    );
    let peer: SocketAddr = ([198, 51, 100, 11], 0).into();
    let app = test_app_with_bypass_peer(peer, bypass).await;

    // A SINGLE fixed player UUID, so the per-UUID counter climbs toward its
    // 20/min ceiling. The peer is bypassed, so per-IP can never trip — yet the
    // 21st submission must still be 429, proving the bypass is per-IP only.
    let player_uuid = Uuid::new_v4().to_string();
    let body = make_test_blob(&player_uuid, 1);
    let hmac = compute_hmac(&body);

    for i in 0..SUBMIT_RATE_LIMIT_MAX {
        let req = submission_request(&body, &player_uuid, 1, &hmac);
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_ne!(
            resp.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "submission {}/{} within the per-UUID window must not be rate-limited",
            i + 1,
            SUBMIT_RATE_LIMIT_MAX,
        );
    }

    // The (MAX + 1)th from the SAME UUID (peer bypassed) → 429 from the
    // per-UUID limit. The per-IP limit cannot be the cause: the bypass skips it.
    let req = submission_request(&body, &player_uuid, 1, &hmac);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);

    let retry_after = resp
        .headers()
        .get("retry-after")
        .expect("per-UUID 429 must carry a Retry-After header");
    let secs: i64 = retry_after
        .to_str()
        .unwrap()
        .parse()
        .expect("Retry-After must be a parseable integer of seconds");
    assert!(secs > 0, "Retry-After must be positive, got {}", secs);
    assert!(
        secs <= SUBMIT_RATE_LIMIT_WINDOW_SECS,
        "Retry-After must not exceed the {}s window, got {}",
        SUBMIT_RATE_LIMIT_WINDOW_SECS,
        secs
    );
}
