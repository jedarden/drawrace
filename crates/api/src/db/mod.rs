use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::time::Duration;

pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await
}

pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("../../crates/api/migrations")
        .run(pool)
        .await
}

pub fn create_redis_pool(redis_url: &str) -> deadpool_redis::Pool {
    let cfg = deadpool_redis::Config {
        url: Some(redis_url.to_string()),
        ..Default::default()
    };
    cfg.create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .expect("failed to create Redis pool")
}
