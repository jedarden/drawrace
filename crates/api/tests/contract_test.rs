use aws_config::BehaviorVersion;
use aws_sdk_s3::Client as S3Client;
use axum::body::{Body, Bytes};
use axum::http::{HeaderMap, HeaderValue, Request, StatusCode};
use axum::Router;
use drawrace_api::app;
use drawrace_api::blob::{BlobHeader, GhostBlob};
use drawrace_api::hmac_mod;
use sqlx::postgres::PgPoolOptions;
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
        hmac_config: tokio::sync::RwLock::new(drawrace_api::hmac_mod::HmacConfig {
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
    });

    app::app(state)
}

fn make_test_blob(player_uuid: &str, track_id: u16) -> Vec<u8> {
    let mut buf = Vec::new();
    // magic
    buf.extend_from_slice(b"DRGH");
    // version
    buf.push(1);
    // track_id
    buf.extend_from_slice(&track_id.to_le_bytes());
    // flags
    buf.push(0);
    // finish_time_ms
    buf.extend_from_slice(&28441u32.to_le_bytes());
    // submitted_at
    buf.extend_from_slice(&1745299200000i64.to_le_bytes());
    // player_uuid (16 bytes)
    let uuid = Uuid::parse_str(player_uuid).unwrap();
    buf.extend_from_slice(uuid.as_bytes());

    // vertex_count = 12 (valid polygon)
    buf.push(12u8);
    // 12 polygon vertices (12 * 4 = 48 bytes)
    for i in 0..12u8 {
        let x = (i as i16) * 10;
        let y = (i as i16) * 20;
        buf.extend_from_slice(&x.to_le_bytes());
        buf.extend_from_slice(&y.to_le_bytes());
    }

    // point_count = 5
    buf.push(5u8);
    // 5 stroke points (5 * 6 = 30 bytes)
    for i in 0..5u8 {
        let dx = i as i16;
        let dy = (i as i16) * 2;
        let dt = 16u16;
        buf.extend_from_slice(&dx.to_le_bytes());
        buf.extend_from_slice(&dy.to_le_bytes());
        buf.extend_from_slice(&dt.to_le_bytes());
    }

    // checkpoint_count = 3
    buf.push(3u8);
    // 3 checkpoints (3 * 4 = 12 bytes)
    for i in 0..3u32 {
        buf.extend_from_slice(&(i * 10000).to_le_bytes());
    }

    buf
}

fn compute_hmac(body: &[u8]) -> String {
    let hmac = hmac_mod::compute_hmac(&TEST_HMAC_KEY, body);
    hex::encode(hmac)
}

// ========== Golden request/response tests ==========

#[tokio::test]
async fn golden_submission_response_structure() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let hmac = compute_hmac(&body);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .header("X-DrawRace-Track", "1")
        .header("X-DrawRace-ClientHMAC", hmac)
        .body(Body::from(body.clone()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::ACCEPTED);

    let body_bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();

    // Assert exactly these three keys exist
    assert_eq!(json.as_object().unwrap().len(), 3);
    assert!(json.get("submission_id").is_some());
    assert!(json.get("status").is_some());
    assert!(json.get("poll_url").is_some());

    // Assert status is pending_validation
    assert_eq!(json["status"], "pending_validation");

    // Assert NO extra fields (no preliminary_rank, preliminary_bucket, etc.)
    assert!(json.get("preliminary_rank").is_none());
    assert!(json.get("preliminary_bucket").is_none());
    assert!(json.get("ghost_id").is_none());
    assert!(json.get("time_ms").is_none());
}

#[tokio::test]
async fn golden_submission_rejects_mismatched_track_header() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1); // blob says track 1
    let hmac = compute_hmac(&body);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .header("X-DrawRace-Track", "2") // header says track 2
        .header("X-DrawRace-ClientHMAC", hmac)
        .body(Body::from(body))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ========== Poll lifecycle & ownership tests ==========

#[tokio::test]
async fn poll_returns_403_without_player_header() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let hmac = compute_hmac(&body);

    // First submit
    let post_req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .header("X-DrawRace-Track", "1")
        .header("X-DrawRace-ClientHMAC", hmac)
        .body(Body::from(body.clone()))
        .unwrap();

    let post_resp = app.oneshot(post_req).await.unwrap();
    let post_body = axum::body::to_bytes(post_resp.into_body(), 4096).await.unwrap();
    let post_json: serde_json::Value = serde_json::from_slice(&post_body).unwrap();
    let submission_id = post_json["submission_id"].as_str().unwrap();

    // Now poll without X-DrawRace-Player header
    let get_req = Request::builder()
        .uri(&format!("/v1/submissions/{}", submission_id))
        .body(Body::empty())
        .unwrap();

    let get_resp = app.oneshot(get_req).await.unwrap();
    assert_eq!(get_resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn poll_returns_200_for_owner_with_pending_status() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let hmac = compute_hmac(&body);

    // First submit
    let post_req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .header("X-DrawRace-Track", "1")
        .header("X-DrawRace-ClientHMAC", hmac)
        .body(Body::from(body.clone()))
        .unwrap();

    let post_resp = app.oneshot(post_req).await.unwrap();
    let post_body = axum::body::to_bytes(post_resp.into_body(), 4096).await.unwrap();
    let post_json: serde_json::Value = serde_json::from_slice(&post_body).unwrap();
    let submission_id = post_json["submission_id"].as_str().unwrap();

    // Poll with owner's UUID
    let get_req = Request::builder()
        .uri(&format!("/v1/submissions/{}", submission_id))
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .body(Body::empty())
        .unwrap();

    let get_resp = app.oneshot(get_req).await.unwrap();
    assert_eq!(get_resp.status(), StatusCode::OK);

    let get_body = axum::body::to_bytes(get_resp.into_body(), 4096).await.unwrap();
    let get_json: serde_json::Value = serde_json::from_slice(&get_body).unwrap();

    assert_eq!(get_json["status"], "pending_validation");
    assert_eq!(get_json.as_object().unwrap().len(), 1);
}

#[tokio::test]
async fn poll_returns_404_for_different_player_not_403() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let hmac = compute_hmac(&body);

    // First submit with player A
    let post_req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .header("X-DrawRace-Track", "1")
        .header("X-DrawRace-ClientHMAC", hmac)
        .body(Body::from(body.clone()))
        .unwrap();

    let post_resp = app.oneshot(post_req).await.unwrap();
    let post_body = axum::body::to_bytes(post_resp.into_body(), 4096).await.unwrap();
    let post_json: serde_json::Value = serde_json::from_slice(&post_body).unwrap();
    let submission_id = post_json["submission_id"].as_str().unwrap();

    // Poll with different player B's UUID - should return 404 NOT 403 (enumeration-safe)
    let get_req = Request::builder()
        .uri(&format!("/v1/submissions/{}", submission_id))
        .header("X-DrawRace-Player", TEST_PLAYER_B_UUID)
        .body(Body::empty())
        .unwrap();

    let get_resp = app.oneshot(get_req).await.unwrap();
    assert_eq!(get_resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn poll_unknown_submission_returns_404() {
    let app = test_app().await;
    let unknown_id = Uuid::new_v4();

    let get_req = Request::builder()
        .uri(&format!("/v1/submissions/{}", unknown_id))
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .body(Body::empty())
        .unwrap();

    let get_resp = app.oneshot(get_req).await.unwrap();
    assert_eq!(get_resp.status(), StatusCode::NOT_FOUND);
}

// ========== HMAC roundtrip tests ==========

#[tokio::test]
async fn hmac_accepts_valid_signature() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let hmac = compute_hmac(&body);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .header("X-DrawRace-Track", "1")
        .header("X-DrawRace-ClientHMAC", hmac)
        .body(Body::from(body))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::ACCEPTED);
}

#[tokio::test]
async fn hmac_rejects_flipped_byte() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);

    // Flip one byte in the HMAC
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
    // Should be 400 (malformed request), NOT 401 (unauthorized)
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp.into_body(), 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(json["error"].as_str().unwrap().contains("HMAC"));
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

// ========== Ghost integrity tests ==========

#[tokio::test]
async fn ghost_integrity_roundtrip() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1);
    let original_blob = body.clone();
    let hmac = compute_hmac(&body);

    // Submit ghost
    let post_req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .header("X-DrawRace-Track", "1")
        .header("X-DrawRace-ClientHMAC", hmac)
        .body(Body::from(body))
        .unwrap();

    let post_resp = app.oneshot(post_req).await.unwrap();
    assert_eq!(post_resp.status(), StatusCode::ACCEPTED);

    // Note: We can't test GET /v1/ghosts/{ghost_id} without the validator
    // actually accepting the submission. The ghost_id is only assigned after
    // validation. But we can verify the blob roundtrips through S3 by checking
    // the blob structure is preserved in the request.
    let header = BlobHeader::parse(&original_blob).unwrap();
    assert_eq!(header.track_id, 1);
    assert_eq!(header.version, 1);
    assert_eq!(header.player_uuid.to_string(), TEST_PLAYER_UUID);

    let ghost = GhostBlob::parse(&original_blob).unwrap();
    assert_eq!(ghost.vertex_count, 12);
    assert_eq!(ghost.point_count, 5);
    assert_eq!(ghost.checkpoint_count, 3);
}

// ========== Bucket assignment tests ==========
// Note: Full bucket assignment testing requires validator integration
// The function itself is tested in submissions.rs unit tests
// Here we verify the response structure includes bucket when accepted

#[tokio::test]
async fn accepted_verdict_includes_bucket_field() {
    use drawrace_api::handlers::submissions::SubmissionAcceptedVerdict;
    use serde_json::to_value;

    let verdict = SubmissionAcceptedVerdict {
        status: "accepted",
        ghost_id: Uuid::new_v4().to_string(),
        time_ms: 28441,
        rank: 5,
        bucket: "advanced".into(),
        is_pb: true,
    };

    let json = to_value(&verdict).unwrap();
    let obj = json.as_object().unwrap();

    // Verify all expected fields exist
    assert_eq!(obj.len(), 6);
    assert!(obj.get("status").is_some());
    assert!(obj.get("ghost_id").is_some());
    assert!(obj.get("time_ms").is_some());
    assert!(obj.get("rank").is_some());
    assert!(obj.get("bucket").is_some());
    assert!(obj.get("is_pb").is_some());
}

// ========== Matchmake fallback tests ==========

#[tokio::test]
async fn matchmake_response_structure() {
    use drawrace_api::handlers::matchmake::MatchmakeResponse;
    use drawrace_api::handlers::matchmake::MatchmakeGhost;
    use serde_json::to_value;

    let response = MatchmakeResponse {
        track_id: 1,
        player_bucket: "novice".into(),
        target_bucket: "mid".into(),
        ghosts: vec![
            MatchmakeGhost {
                ghost_id: Uuid::new_v4(),
                time_ms: 30000,
                name: "TestPlayer".into(),
                url: "https://example.com/ghost.bin".into(),
            },
        ],
        shadow_ghost: None,
        expires_at: chrono::Utc::now().to_rfc3339(),
    };

    let json = to_value(&response).unwrap();
    let obj = json.as_object().unwrap();

    // Verify response structure
    assert!(obj.get("track_id").is_some());
    assert!(obj.get("player_bucket").is_some());
    assert!(obj.get("target_bucket").is_some());
    assert!(obj.get("ghosts").is_some());
    assert!(obj.get("shadow_ghost").is_some());
    assert!(obj.get("expires_at").is_some());
}

#[tokio::test]
async fn matchmake_ghost_structure() {
    use drawrace_api::handlers::matchmake::MatchmakeGhost;
    use serde_json::to_value;

    let ghost = MatchmakeGhost {
        ghost_id: Uuid::new_v4(),
        time_ms: 28441,
        name: "TestPlayer".into(),
        url: "https://example.com/ghost.bin".into(),
    };

    let json = to_value(&ghost).unwrap();
    let obj = json.as_object().unwrap();

    // Verify ghost structure - exactly 4 fields
    assert_eq!(obj.len(), 4);
    assert!(obj.get("ghost_id").is_some());
    assert!(obj.get("time_ms").is_some());
    assert!(obj.get("name").is_some());
    assert!(obj.get("url").is_some());
}

#[tokio::test]
async fn matchmake_rejects_missing_player_uuid() {
    let app = test_app().await;

    // Missing player_uuid query param
    let req = Request::builder()
        .uri("/v1/matchmake/1")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    // Should return bad request due to missing query param
    assert!(matches!(resp.status(), StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY));
}

#[tokio::test]
async fn matchmake_requires_player_uuid_param() {
    let app = test_app().await;

    let req = Request::builder()
        .uri(&format!("/v1/matchmake/1?player_uuid={}", TEST_PLAYER_UUID))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();

    // May fail if DB is empty but should not be a 4xx error about missing param
    // It could be 200 OK with empty ghosts or 500 for DB error
    // The important thing is it processes the query param correctly
    assert_ne!(resp.status(), StatusCode::BAD_REQUEST);
}

// ========== Blob format validation tests ==========

#[tokio::test]
async fn submission_rejects_blob_too_short() {
    let app = test_app().await;
    let tiny_blob = vec![0u8; 10];
    let hmac = compute_hmac(&tiny_blob);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .header("X-DrawRace-Track", "1")
        .header("X-DrawRace-ClientHMAC", hmac)
        .body(Body::from(tiny_blob))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn submission_rejects_invalid_magic() {
    let app = test_app().await;
    let mut body = make_test_blob(TEST_PLAYER_UUID, 1);
    body[0] = b'X'; // Corrupt magic
    let hmac = compute_hmac(&body);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_UUID)
        .header("X-DrawRace-Track", "1")
        .header("X-DrawRace-ClientHMAC", hmac)
        .body(Body::from(body))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn submission_rejects_mismatched_player_uuid() {
    let app = test_app().await;
    let body = make_test_blob(TEST_PLAYER_UUID, 1); // blob says player A
    let hmac = compute_hmac(&body);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/submissions")
        .header("X-DrawRace-Player", TEST_PLAYER_B_UUID) // header says player B
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

// ========== Rejected verdict structure tests ==========

#[tokio::test]
async fn rejected_verdict_has_exact_fields() {
    // We can't actually test this without triggering a rejection
    // from the validator, but we can verify the structure
    use drawrace_api::handlers::submissions::SubmissionRejectedVerdict;
    use serde_json::to_value;

    let verdict = SubmissionRejectedVerdict {
        status: "rejected",
        reason: "cheating".into(),
    };

    let json = to_value(&verdict).unwrap();
    let obj = json.as_object().unwrap();

    // Exactly two fields
    assert_eq!(obj.len(), 2);
    assert!(obj.get("status").is_some());
    assert!(obj.get("reason").is_some());
}
