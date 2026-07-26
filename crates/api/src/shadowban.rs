//! Shadowban status checking helper for API handlers.
//!
//! Per plan §Multiplayer & Backend 8 (Layer 3), a player whose rejection rate
//! exceeds 20% over a rolling 50-submission window is shadowbanned: their
//! accepted submissions are still stored (so the shadowban is invisible to them)
//! but never surfaced to other players. The **enforcement** itself happens at
//! the SQL query level — `handlers/leaderboard.rs` and `handlers/matchmake.rs`
//! filter with `WHERE p.shadowbanned = false`.
//!
//! [`is_shadowbanned`] is the lookup helper for handlers that need the boolean
//! directly (logging, monitoring, conditional behavior). The rejection-rate
//! computation and the `shadowbanned` column flip live in the validator
//! (`crates/validator/src/shadowban.rs`), invoked after each verdict.

use sqlx::PgPool;
use uuid::Uuid;

/// Check whether a player is currently shadowbanned.
///
/// Reads the `players.shadowbanned` column directly.
///
/// # Returns
/// * `Ok(true)` — player is shadowbanned.
/// * `Ok(false)` — player is not shadowbanned, or has no `players` row.
/// * `Err` — a database error occurred.
///
/// Handlers that only need a best-effort answer can `.unwrap_or_default()` the
/// `sqlx::Result`.
pub async fn is_shadowbanned(pool: &PgPool, player_uuid: Uuid) -> sqlx::Result<bool> {
    let shadowbanned: Option<bool> =
        sqlx::query_scalar("SELECT shadowbanned FROM players WHERE player_uuid = $1")
            .bind(player_uuid)
            .fetch_optional(pool)
            .await?;
    Ok(shadowbanned.unwrap_or(false))
}
