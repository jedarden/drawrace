use aws_config::BehaviorVersion;
use aws_sdk_s3::Client as S3Client;
use drawrace_api::hmac_mod::HmacConfig;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            EnvFilter::from_default_env().add_directive("info".parse().unwrap()),
        )
        .init();

    let database_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
    let listen_addr =
        std::env::var("LISTEN_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());
    let s3_bucket =
        std::env::var("S3_BUCKET").unwrap_or_else(|_| "drawrace-ghosts".into());
    let s3_endpoint = std::env::var("S3_ENDPOINT").ok();
    let hmac_current =
        std::env::var("HMAC_CURRENT_KEY").expect("HMAC_CURRENT_KEY must be set");
    let hmac_previous = std::env::var("HMAC_PREVIOUS_KEY").unwrap_or_default();

    let pool = drawrace_api::db::create_pool(&database_url)
        .await
        .expect("failed to create Postgres pool");

    drawrace_api::db::run_migrations(&pool)
        .await
        .expect("failed to run migrations");

    let mut s3_config = aws_config::defaults(BehaviorVersion::latest());
    if let Some(endpoint) = s3_endpoint {
        s3_config = s3_config_endpoint_url(endpoint);
    }
    let s3_client = S3Client::new(&s3_config.load().await);

    let redis_pool = drawrace_api::db::create_redis_pool(&redis_url);

    // Load seed ghosts on first startup (idempotent)
    drawrace_api::seed::load_seeds_if_empty(&pool, &s3_client, &s3_bucket)
        .await
        .expect("failed to load seed ghosts");

    let state = Arc::new(drawrace_api::AppState {
        pool,
        redis: redis_pool,
        s3: s3_client,
        s3_bucket,
        hmac_config: tokio::sync::RwLock::new(HmacConfig {
            current_key: hex::decode(&hmac_current).expect("HMAC_CURRENT_KEY must be hex"),
            previous_key: if hmac_previous.is_empty() {
                None
            } else {
                Some(hex::decode(&hmac_previous).expect("HMAC_PREVIOUS_KEY must be hex"))
            },
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

    let app = drawrace_api::app::app(state);

    let listener = tokio::net::TcpListener::bind(&listen_addr)
        .await
        .expect("failed to bind listener");

    tracing::info!(addr = %listen_addr, "drawrace-api listening");
    axum::serve(listener, app).await.expect("server error");
}

fn s3_config_endpoint_url(endpoint: String) -> aws_config::ConfigLoader {
    aws_config::defaults(BehaviorVersion::latest())
        .region(aws_sdk_s3::config::Region::new("garage"))
        .endpoint_url(endpoint)
}
