//! Rolling-window shadowban integration tests.
//!
//! These exercise the *persistence* layer (`record_submission_verdict`,
//! `calculate_rejection_rate`, `update_shadowban_status`) against a real
//! Postgres instance. The pure eviction/rate/threshold policy — including the
//! headline "51st verdict evicts the oldest" property — is unit-tested with no
//! database in `crates/validator/src/shadowban.rs`.
//!
//! All tests here are skipped when `DATABASE_URL` is unset (CI without a DB),
//! so they never block `cargo test`.

use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;

/// Skipping helper: returns `true` (and prints a note) when no DB is configured.
fn skip_without_db() -> bool {
    match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => false,
        _ => {
            println!("Skipping shadowban rolling-window test: DATABASE_URL not set");
            true
        }
    }
}

/// Test that the 51st submission evicts the oldest from the player's window.
///
/// Inserts 51 verdicts and asserts:
/// 1. The most-recent-50 window holds exactly 50.
/// 2. Exactly one submission for the player falls outside that window.
/// 3. That evicted submission is the very first (oldest) one inserted.
#[tokio::test]
async fn rolling_window_evicts_oldest_submission() -> Result<()> {
    if skip_without_db() {
        return Ok(());
    }
    let database_url = std::env::var("DATABASE_URL").unwrap();
    let pool = PgPool::connect(&database_url).await?;

    let player_uuid = Uuid::new_v4();
    sqlx::query("INSERT INTO players (player_uuid, shadowbanned) VALUES ($1, false)")
        .bind(player_uuid)
        .execute(&pool)
        .await?;

    // Record 51 alternating verdicts. Capture the first submission_id so we can
    // prove it is the one evicted. Small sleeps keep created_at ordered.
    let mut first_submission_id: Option<Uuid> = None;
    for i in 0..51 {
        let submission_id = Uuid::new_v4();
        if i == 0 {
            first_submission_id = Some(submission_id);
        }
        let status = if i % 2 == 0 { "accepted" } else { "rejected" };

        sqlx::query(
            "INSERT INTO submissions (submission_id, player_uuid, track_id, physics_version, status)
             VALUES ($1, $2, 1, 4, $3)",
        )
        .bind(submission_id)
        .bind(player_uuid)
        .bind(status)
        .execute(&pool)
        .await?;

        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

        drawrace_validator::shadowban::record_submission_verdict(
            &pool,
            player_uuid,
            submission_id,
            status,
        )
        .await?;
    }

    // The window the policy reads is exactly 50 rows.
    let window_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM (
            SELECT submission_id FROM player_submission_history
            WHERE player_uuid = $1
            ORDER BY created_at DESC, submission_id DESC
            LIMIT 50
        ) AS recent_submissions",
    )
    .bind(player_uuid)
    .fetch_one(&pool)
    .await?;
    assert_eq!(window_count, 50, "rolling window must hold exactly 50");

    // Exactly one submission falls outside the most-recent-50 window — and it is
    // the first (oldest) one we inserted. This is the eviction property.
    let evicted: Vec<(Uuid,)> = sqlx::query_as(
        "SELECT submission_id FROM player_submission_history
         WHERE player_uuid = $1
           AND submission_id NOT IN (
               SELECT submission_id FROM player_submission_history
               WHERE player_uuid = $1
               ORDER BY created_at DESC, submission_id DESC
               LIMIT 50
           )",
    )
    .bind(player_uuid)
    .fetch_all(&pool)
    .await?;
    assert_eq!(evicted.len(), 1, "exactly one submission should be evicted");
    assert_eq!(
        evicted[0].0,
        first_submission_id.expect("first submission id was captured"),
        "the evicted submission must be the oldest (first inserted)"
    );

    cleanup(&pool, player_uuid).await?;
    Ok(())
}

/// The rejection rate over the window reflects only the most recent 50 verdicts.
#[tokio::test]
async fn rejection_rate_uses_only_recent_50() -> Result<()> {
    if skip_without_db() {
        return Ok(());
    }
    let database_url = std::env::var("DATABASE_URL").unwrap();
    let pool = PgPool::connect(&database_url).await?;

    let player_uuid = Uuid::new_v4();
    sqlx::query("INSERT INTO players (player_uuid, shadowbanned) VALUES ($1, false)")
        .bind(player_uuid)
        .execute(&pool)
        .await?;

    // 50 accepted, then 10 rejected. The window keeps the 40 most-recent
    // accepted + the 10 rejected = 10/50 = 0.20.
    for _ in 0..50 {
        record(&pool, player_uuid, "accepted").await?;
    }
    for _ in 0..10 {
        record(&pool, player_uuid, "rejected").await?;
    }
    let rate =
        drawrace_validator::shadowban::calculate_rejection_rate(&pool, player_uuid, 50).await?;
    assert!(
        (rate - 0.20).abs() < 1e-9,
        "expected 10/50 = 0.20 after eviction, got {rate}"
    );

    // One more rejected → 11/50 = 0.22 (over threshold).
    record(&pool, player_uuid, "rejected").await?;
    let rate =
        drawrace_validator::shadowban::calculate_rejection_rate(&pool, player_uuid, 50).await?;
    assert!(
        (rate - 0.22).abs() < 1e-9,
        "expected 11/50 = 0.22 after one more rejection, got {rate}"
    );

    cleanup(&pool, player_uuid).await?;
    Ok(())
}

/// `update_shadowban_status` honours the minimum-submission guard, the strict
/// `> 20%` threshold, and the ban/unban flip.
#[tokio::test]
async fn shadowban_update_edge_cases() -> Result<()> {
    if skip_without_db() {
        return Ok(());
    }
    let database_url = std::env::var("DATABASE_URL").unwrap();
    let pool = PgPool::connect(&database_url).await?;

    // (1) Fewer than MIN_SUBMISSIONS: never shadowbanned, even at 100% rejected.
    let p1 = Uuid::new_v4();
    sqlx::query("INSERT INTO players (player_uuid, shadowbanned) VALUES ($1, false)")
        .bind(p1)
        .execute(&pool)
        .await?;
    for _ in 0..5 {
        record(&pool, p1, "rejected").await?;
    }
    drawrace_validator::shadowban::update_shadowban_status(&pool, p1).await?;
    assert!(
        !banned(&pool, p1).await?,
        "<10 submissions must not shadowban"
    );

    // (2) Exactly 20% (2 of 10 rejected): NOT shadowbanned (strictly greater).
    let p2 = Uuid::new_v4();
    sqlx::query("INSERT INTO players (player_uuid, shadowbanned) VALUES ($1, false)")
        .bind(p2)
        .execute(&pool)
        .await?;
    for i in 0..10 {
        record(&pool, p2, if i < 8 { "accepted" } else { "rejected" }).await?;
    }
    drawrace_validator::shadowban::update_shadowban_status(&pool, p2).await?;
    assert!(
        !banned(&pool, p2).await?,
        "exactly 20% must not shadowban (policy is strictly greater)"
    );

    // (3) 30% (3 of 10 rejected): shadowbanned. Then drive back below to unban.
    let p3 = Uuid::new_v4();
    sqlx::query("INSERT INTO players (player_uuid, shadowbanned) VALUES ($1, false)")
        .bind(p3)
        .execute(&pool)
        .await?;
    for i in 0..10 {
        record(&pool, p3, if i < 7 { "accepted" } else { "rejected" }).await?;
    }
    drawrace_validator::shadowban::update_shadowban_status(&pool, p3).await?;
    assert!(
        banned(&pool, p3).await?,
        "30% rejection rate must shadowban"
    );

    // Push 45 more accepted: the 3 rejections get evicted from the 50-window →
    // 0/50 = 0%, which lifts the ban.
    for _ in 0..45 {
        record(&pool, p3, "accepted").await?;
    }
    drawrace_validator::shadowban::update_shadowban_status(&pool, p3).await?;
    assert!(
        !banned(&pool, p3).await?,
        "ban must lift once the rejection rate drops to-or-below threshold"
    );

    for uuid in [p1, p2, p3] {
        cleanup(&pool, uuid).await?;
    }
    Ok(())
}

/// Insert a submission row + record its verdict in history (the two-step a real
/// verdict performs). Sleeps keep `created_at` ordered.
async fn record(pool: &PgPool, player_uuid: Uuid, status: &str) -> Result<()> {
    let submission_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO submissions (submission_id, player_uuid, track_id, physics_version, status)
         VALUES ($1, $2, 1, 4, $3)",
    )
    .bind(submission_id)
    .bind(player_uuid)
    .bind(status)
    .execute(pool)
    .await?;
    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
    drawrace_validator::shadowban::record_submission_verdict(
        pool,
        player_uuid,
        submission_id,
        status,
    )
    .await
}

async fn banned(pool: &PgPool, player_uuid: Uuid) -> Result<bool> {
    let v: bool = sqlx::query_scalar("SELECT shadowbanned FROM players WHERE player_uuid = $1")
        .bind(player_uuid)
        .fetch_one(pool)
        .await?;
    Ok(v)
}

async fn cleanup(pool: &PgPool, player_uuid: Uuid) -> Result<()> {
    // ON DELETE CASCADE on player_submission_history + submissions handles the
    // dependent rows; deleting the player row is sufficient.
    sqlx::query("DELETE FROM players WHERE player_uuid = $1")
        .bind(player_uuid)
        .execute(pool)
        .await?;
    Ok(())
}
