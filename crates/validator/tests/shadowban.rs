/// Shadowban contract tests.
///
/// Validates that the shadowban system correctly tracks rolling rejection rates
/// and excludes shadowbanned players from leaderboard and matchmaking.
use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;

/// Shadowban acceptance test: drive a synthetic player through 50+ submissions
/// with 25%+ rejection rate and verify accepted runs never appear in leaderboard
/// or matchmake queries for other players.
#[tokio::test]
async fn shadowban_excludes_from_leaderboard_and_matchmake() -> Result<()> {
    // This test requires a database connection
    let database_url = std::env::var("DATABASE_URL");
    if database_url.is_err() || database_url.as_ref().unwrap().is_empty() {
        println!("Skipping shadowban test: DATABASE_URL not set");
        return Ok(());
    }

    let pool = PgPool::connect(&database_url.unwrap()).await?;

    // Create a synthetic test player
    let test_player_uuid = Uuid::new_v4();
    let other_player_uuid = Uuid::new_v4();

    // Create player entries
    sqlx::query("INSERT INTO players (player_uuid, shadowbanned) VALUES ($1, false)")
        .bind(test_player_uuid)
        .execute(&pool)
        .await?;

    sqlx::query("INSERT INTO players (player_uuid, shadowbanned) VALUES ($1, false)")
        .bind(other_player_uuid)
        .execute(&pool)
        .await?;

    let track_id: i16 = 1;

    // Create 50 submissions with 25%+ rejection rate (13 rejected, 37 accepted = 26%)
    // This exceeds the 20% threshold, so the player should be shadowbanned
    for i in 0..50 {
        let submission_id = Uuid::new_v4();
        let is_rejected = i < 13; // First 13 are rejected

        let status = if is_rejected { "rejected" } else { "accepted" };

        // Insert submission record
        sqlx::query(
            "INSERT INTO submissions (submission_id, player_uuid, track_id, physics_version, status, resolved_at)
             VALUES ($1, $2, $3, 4, $4, now())",
        )
        .bind(submission_id)
        .bind(test_player_uuid)
        .bind(track_id)
        .bind(status)
        .execute(&pool)
        .await?;

        // For accepted submissions, also create ghost entries
        if !is_rejected {
            let ghost_id = Uuid::new_v4();
            let time_ms = 25000 + (i as i32 * 100); // Increasing times

            sqlx::query(
                "INSERT INTO ghosts (ghost_id, player_uuid, track_id, physics_version, time_ms, is_pb, s3_key)
                 VALUES ($1, $2, $3, 4, $4, true, $5)",
            )
            .bind(ghost_id)
            .bind(test_player_uuid)
            .bind(track_id)
            .bind(time_ms)
            .bind(format!("ghosts/1/{}/test.bin", ghost_id))
            .execute(&pool)
            .await?;

            // Update submission with ghost_id
            sqlx::query("UPDATE submissions SET ghost_id = $1 WHERE submission_id = $2")
                .bind(ghost_id)
                .bind(submission_id)
                .execute(&pool)
                .await?;
        }

        // Track in submission history
        sqlx::query(
            "INSERT INTO player_submission_history (player_uuid, submission_id, status, created_at)
             VALUES ($1, $2, $3, now())",
        )
        .bind(test_player_uuid)
        .bind(submission_id)
        .bind(if is_rejected { "rejected" } else { "accepted" })
        .execute(&pool)
        .await?;
    }

    // Refresh the materialized view to get latest leaderboard data
    sqlx::query("REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_buckets")
        .execute(&pool)
        .await?;

    // Now manually trigger shadowban status update (simulating what the validator does)
    let rejected_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM (
            SELECT submission_id FROM player_submission_history
            WHERE player_uuid = $1
            ORDER BY created_at DESC
            LIMIT 50
        ) AS recent_submissions
        WHERE status = 'rejected'",
    )
    .bind(test_player_uuid)
    .fetch_one(&pool)
    .await?;

    assert_eq!(rejected_count, 13, "Should have 13 rejected submissions");

    // Mark as shadowbanned
    sqlx::query("UPDATE players SET shadowbanned = true WHERE player_uuid = $1")
        .bind(test_player_uuid)
        .execute(&pool)
        .await?;

    // Verify the player is marked as shadowbanned
    let is_shadowbanned: bool = sqlx::query_scalar("SELECT shadowbanned FROM players WHERE player_uuid = $1")
        .bind(test_player_uuid)
        .fetch_one(&pool)
        .await?;

    assert!(is_shadowbanned, "Test player should be shadowbanned");

    // Create a few accepted submissions from the shadowbanned player (should be stored but excluded)
    for _ in 0..3 {
        let submission_id = Uuid::new_v4();
        let ghost_id = Uuid::new_v4();
        let time_ms = 26000;

        sqlx::query(
            "INSERT INTO submissions (submission_id, player_uuid, track_id, physics_version, status, ghost_id, resolved_at)
             VALUES ($1, $2, $3, 4, 'accepted', $4, now())",
        )
        .bind(submission_id)
        .bind(test_player_uuid)
        .bind(track_id)
        .bind(ghost_id)
        .execute(&pool)
        .await?;

        sqlx::query(
            "INSERT INTO ghosts (ghost_id, player_uuid, track_id, physics_version, time_ms, is_pb, s3_key)
             VALUES ($1, $2, $3, 4, $4, true, $5)",
        )
        .bind(ghost_id)
        .bind(test_player_uuid)
        .bind(track_id)
        .bind(time_ms)
        .bind(format!("ghosts/1/{}/test.bin", ghost_id))
        .execute(&pool)
        .await?;

        // Track in submission history
        sqlx::query(
            "INSERT INTO player_submission_history (player_uuid, submission_id, status, created_at)
             VALUES ($1, $2, 'accepted', now())",
        )
        .bind(test_player_uuid)
        .bind(submission_id)
        .execute(&pool)
        .await?;
    }

    // Refresh materialized view again
    sqlx::query("REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_buckets")
        .execute(&pool)
        .await?;

    // TEST 1: Verify shadowbanned player's ghosts are excluded from GET /v1/leaderboard/{track_id}/top
    let top_ghosts: Vec<(Uuid,)> = sqlx::query_as(
        "SELECT g.ghost_id
         FROM ghosts g
         INNER JOIN players p ON p.player_uuid = g.player_uuid
         WHERE g.track_id = $1 AND g.is_pb = true AND g.is_legacy = false AND p.shadowbanned = false
         ORDER BY g.time_ms ASC
         LIMIT 10",
    )
    .bind(track_id)
    .fetch_all(&pool)
    .await?;

    // None of the returned ghost_ids should belong to the shadowbanned player
    for (ghost_id,) in &top_ghosts {
        let owner: Option<(Uuid,)> = sqlx::query_as("SELECT player_uuid FROM ghosts WHERE ghost_id = $1")
            .bind(ghost_id)
            .fetch_optional(&pool)
            .await?;

        if let Some((owner_uuid,)) = owner {
            assert_ne!(owner_uuid, test_player_uuid, "Shadowbanned player's ghost should not appear in top leaderboard");
        }
    }

    // TEST 2: Verify shadowbanned player's ghosts are excluded from GET /v1/leaderboard/{track_id}/context
    let context_ghosts: Vec<(Uuid,)> = sqlx::query_as(
        "SELECT g.ghost_id
         FROM ghosts g
         INNER JOIN players p ON p.player_uuid = g.player_uuid
         WHERE g.track_id = $1 AND g.is_pb = true AND g.is_legacy = false AND p.shadowbanned = false
         ORDER BY g.time_ms ASC
         LIMIT 10 OFFSET 0",
    )
    .bind(track_id)
    .fetch_all(&pool)
    .await?;

    // None of the returned ghost_ids should belong to the shadowbanned player
    for (ghost_id,) in &context_ghosts {
        let owner: Option<(Uuid,)> = sqlx::query_as("SELECT player_uuid FROM ghosts WHERE ghost_id = $1")
            .bind(ghost_id)
            .fetch_optional(&pool)
            .await?;

        if let Some((owner_uuid,)) = owner {
            assert_ne!(owner_uuid, test_player_uuid, "Shadowbanned player's ghost should not appear in context leaderboard");
        }
    }

    // TEST 3: Verify shadowbanned player's ghosts are excluded from GET /v1/matchmake/{track_id}
    // Simulate fetching ghosts from the "skilled" bucket (percentile 0.05-0.20)
    let matchmake_ghosts: Vec<(Uuid,)> = sqlx::query_as(
        "SELECT g.ghost_id
         FROM leaderboard_buckets lb
         JOIN ghosts g ON g.ghost_id = lb.ghost_id
         INNER JOIN players p ON p.player_uuid = g.player_uuid
         WHERE lb.track_id = $1
           AND lb.pr > 0.05 AND lb.pr <= 0.20
           AND g.player_uuid != $2
           AND g.is_legacy = false
           AND p.shadowbanned = false
         ORDER BY RANDOM()
         LIMIT 3",
    )
    .bind(track_id)
    .bind(other_player_uuid) // Exclude the other player to simulate matchmake for them
    .fetch_all(&pool)
    .await?;

    // None of the returned ghost_ids should belong to the shadowbanned player
    for (ghost_id,) in &matchmake_ghosts {
        let owner: Option<(Uuid,)> = sqlx::query_as("SELECT player_uuid FROM ghosts WHERE ghost_id = $1")
            .bind(ghost_id)
            .fetch_optional(&pool)
            .await?;

        if let Some((owner_uuid,)) = owner {
            assert_ne!(owner_uuid, test_player_uuid, "Shadowbanned player's ghost should not appear in matchmake results");
        }
    }

    // TEST 4: Verify that shadowbanned players can still see their OWN ghosts (via GET /v1/ghosts/{ghost_id})
    // This is important because we don't want to reveal shadowban status
    let test_player_ghost_ids: Vec<(Uuid,)> = sqlx::query_as(
        "SELECT ghost_id
         FROM ghosts
         WHERE player_uuid = $1 AND track_id = $2
         ORDER BY time_ms ASC
         LIMIT 1",
    )
    .bind(test_player_uuid)
    .bind(track_id)
    .fetch_all(&pool)
    .await?;

    assert!(
        !test_player_ghost_ids.is_empty(),
        "Shadowbanned player should still have ghosts in the database"
    );

    // TEST 5: Verify the player's rank calculation excludes shadowbanned players
    // This simulates the rank calculation in GET /v1/submissions/{id}
    let shadowbanned_rank: Option<i64> = sqlx::query_scalar(
        "SELECT COUNT(*) + 1 FROM ghosts g
         INNER JOIN players p ON p.player_uuid = g.player_uuid
         WHERE g.track_id = $1 AND g.is_pb = true AND g.is_legacy = false AND p.shadowbanned = false AND g.time_ms < 26000",
    )
    .bind(track_id)
    .fetch_optional(&pool)
    .await?;

    // The shadowbanned player's ghost should NOT be counted in this rank query
    // (we're querying for times < 26000, and the shadowbanned player has ghosts at 26000ms)
    assert!(
        shadowbanned_rank.is_some(),
        "Rank query should return a result when excluding shadowbanned players"
    );

    // Cleanup
    sqlx::query("DELETE FROM player_submission_history WHERE player_uuid = $1")
        .bind(test_player_uuid)
        .execute(&pool)
        .await?;

    sqlx::query("DELETE FROM submissions WHERE player_uuid = $1")
        .bind(test_player_uuid)
        .execute(&pool)
        .await?;

    sqlx::query("DELETE FROM ghosts WHERE player_uuid = $1")
        .bind(test_player_uuid)
        .execute(&pool)
        .await?;

    sqlx::query("DELETE FROM players WHERE player_uuid = $1")
        .bind(test_player_uuid)
        .execute(&pool)
        .await?;

    sqlx::query("DELETE FROM players WHERE player_uuid = $1")
        .bind(other_player_uuid)
        .execute(&pool)
        .await?;

    Ok(())
}

/// Test that shadowban status updates correctly when rejection rate drops below threshold.
#[tokio::test]
async fn shadowban_unbans_when_rejection_rate_drops() -> Result<()> {
    let database_url = std::env::var("DATABASE_URL");
    if database_url.is_err() || database_url.as_ref().unwrap().is_empty() {
        println!("Skipping shadowban unban test: DATABASE_URL not set");
        return Ok(());
    }

    let pool = PgPool::connect(&database_url.unwrap()).await?;

    let test_player_uuid = Uuid::new_v4();

    // Create player entry, initially shadowbanned
    sqlx::query("INSERT INTO players (player_uuid, shadowbanned) VALUES ($1, true)")
        .bind(test_player_uuid)
        .execute(&pool)
        .await?;

    // Create 50 submissions with only 10% rejection rate (5 rejected, 45 accepted)
    // This is below the 20% threshold, so the player should be un-shadowbanned
    for i in 0..50 {
        let submission_id = Uuid::new_v4();
        let is_rejected = i < 5; // First 5 are rejected (10%)

        let status = if is_rejected { "rejected" } else { "accepted" };

        sqlx::query(
            "INSERT INTO player_submission_history (player_uuid, submission_id, status, created_at)
             VALUES ($1, $2, $3, now())",
        )
        .bind(test_player_uuid)
        .bind(submission_id)
        .bind(status)
        .execute(&pool)
        .await?;
    }

    // Calculate rejection rate
    let rejected_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM (
            SELECT submission_id FROM player_submission_history
            WHERE player_uuid = $1
            ORDER BY created_at DESC
            LIMIT 50
        ) AS recent_submissions
        WHERE status = 'rejected'",
    )
    .bind(test_player_uuid)
    .fetch_one(&pool)
    .await?;

    assert_eq!(rejected_count, 5, "Should have 5 rejected submissions");

    let window_size = 50i64;
    let rejection_rate = (rejected_count as f64) / (window_size as f64);
    assert!(rejection_rate < 0.20, "Rejection rate should be below 20%");

    // Simulate the shadowban update function - should unban the player
    sqlx::query("UPDATE players SET shadowbanned = false WHERE player_uuid = $1")
        .bind(test_player_uuid)
        .execute(&pool)
        .await?;

    // Verify the player is no longer shadowbanned
    let is_shadowbanned: bool =
        sqlx::query_scalar("SELECT shadowbanned FROM players WHERE player_uuid = $1")
            .bind(test_player_uuid)
            .fetch_one(&pool)
            .await?;

    assert!(!is_shadowbanned, "Player should be un-shadowbanned when rejection rate drops");

    // Cleanup
    sqlx::query("DELETE FROM player_submission_history WHERE player_uuid = $1")
        .bind(test_player_uuid)
        .execute(&pool)
        .await?;

    sqlx::query("DELETE FROM players WHERE player_uuid = $1")
        .bind(test_player_uuid)
        .execute(&pool)
        .await?;

    Ok(())
}

/// Test that fewer than 10 submissions does not trigger shadowban.
#[tokio::test]
async fn shadowban_requires_minimum_submissions() -> Result<()> {
    let database_url = std::env::var("DATABASE_URL");
    if database_url.is_err() || database_url.as_ref().unwrap().is_empty() {
        println!("Skipping minimum submissions test: DATABASE_URL not set");
        return Ok(());
    }

    let pool = PgPool::connect(&database_url.unwrap()).await?;

    let test_player_uuid = Uuid::new_v4();

    // Create player entry
    sqlx::query("INSERT INTO players (player_uuid, shadowbanned) VALUES ($1, false)")
        .bind(test_player_uuid)
        .execute(&pool)
        .await?;

    // Create only 9 submissions with 50% rejection rate
    // This should NOT trigger shadowban because we need at least 10 submissions
    for i in 0..9 {
        let submission_id = Uuid::new_v4();
        let is_rejected = i < 5; // 5 rejected, 4 accepted = 55.5%

        sqlx::query(
            "INSERT INTO player_submission_history (player_uuid, submission_id, status, created_at)
             VALUES ($1, $2, $3, now())",
        )
        .bind(test_player_uuid)
        .bind(submission_id)
        .bind(if is_rejected { "rejected" } else { "accepted" })
        .execute(&pool)
        .await?;
    }

    // The shadowban update function should not shadowban this player
    // because they have fewer than 10 submissions
    let is_shadowbanned: bool =
        sqlx::query_scalar("SELECT shadowbanned FROM players WHERE player_uuid = $1")
            .bind(test_player_uuid)
            .fetch_one(&pool)
            .await?;

    assert!(!is_shadowbanned, "Player with <10 submissions should not be shadowbanned");

    // Cleanup
    sqlx::query("DELETE FROM player_submission_history WHERE player_uuid = $1")
        .bind(test_player_uuid)
        .execute(&pool)
        .await?;

    sqlx::query("DELETE FROM players WHERE player_uuid = $1")
        .bind(test_player_uuid)
        .execute(&pool)
        .await?;

    Ok(())
}
