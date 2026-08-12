//! Shadowban tracking: per-player rolling rejection-rate window.
//!
//! Plan §Multiplayer & Backend 8 (Layer 3): *"A player's rejection rate
//! exceeding 20% on a 50-run rolling window triggers shadowban (their
//! submissions are accepted locally, never surfaced to others)."*
//!
//! The rate / threshold / eviction policy lives in [`RollingRejectionWindow`], a
//! pure value type — that is what makes the policy unit-testable without a
//! database (see the `tests` module: the 51st verdict evicts the oldest, the 20%
//! boundary is exact, the minimum-submission guard holds). The async functions
//! below are the persistence layer: they read the last verdicts from
//! `player_submission_history` (schema in `migrations/012_shadowban.sql`), feed
//! them into the window, and apply the resulting decision to the
//! `players.shadowbanned` column. Enforcement at query time — excluding
//! shadowbanned players from leaderboard / matchmaking — happens in the API
//! (`crates/api/src/handlers/{leaderboard,matchmake}.rs`, `WHERE
//! p.shadowbanned = false`).

use std::collections::VecDeque;

use anyhow::{Context, Result};
use sqlx::PgPool;
use uuid::Uuid;

/// Maximum number of recent verdicts the rolling window keeps per player.
pub const WINDOW_SIZE: usize = 50;

/// A player must have at least this many recorded verdicts before the rejection
/// rate can trigger a shadowban. Guards against banning a brand-new player over
/// a couple of early rejections before they have a meaningful history.
pub const MIN_SUBMISSIONS: usize = 10;

/// Rejection rate (rejected / window size) strictly above which a player is
/// shadowbanned. At *exactly* 20% the player is **not** shadowbanned — the
/// policy fires only on a rate strictly greater than this threshold.
pub const SHADOWBAN_THRESHOLD: f64 = 0.20;

/// A rolling window over a player's most recent submission verdicts.
///
/// Holds at most [`WINDOW_SIZE`] verdicts; recording a verdict past the cap
/// evicts the **oldest** (FIFO). `true` means the verdict was `rejected`,
/// `false` means `accepted`. Pure: no I/O, deterministic, and trivially
/// unit-testable — the policy below is enforced entirely through this type.
#[derive(Debug, Clone, Default)]
pub struct RollingRejectionWindow {
    /// Most-recent-last. `verdicts.front()` is the oldest verdict still held.
    verdicts: VecDeque<bool>,
}

impl RollingRejectionWindow {
    /// Build a window from verdicts in **oldest-first** order, keeping only the
    /// most recent [`WINDOW_SIZE`]. Convenient for reconstructing a window from
    /// DB rows (the loader returns oldest-first).
    pub fn from_verdicts(verdicts: impl IntoIterator<Item = bool>) -> Self {
        let mut window = Self::default();
        for rejected in verdicts {
            window.record(rejected);
        }
        window
    }

    /// Record a verdict (`true` = rejected, `false` = accepted). If the window
    /// is already full, the oldest verdict is evicted to make room.
    pub fn record(&mut self, rejected: bool) {
        if self.verdicts.len() >= WINDOW_SIZE {
            self.verdicts.pop_front();
        }
        self.verdicts.push_back(rejected);
    }

    /// Number of verdicts currently held (`0..=WINDOW_SIZE`).
    pub fn len(&self) -> usize {
        self.verdicts.len()
    }

    /// Whether the window holds no verdicts.
    pub fn is_empty(&self) -> bool {
        self.verdicts.is_empty()
    }

    /// Count of rejected verdicts in the window.
    pub fn rejected_count(&self) -> usize {
        self.verdicts.iter().filter(|v| **v).count()
    }

    /// Rejection rate over the window: `rejected_count / len`.
    ///
    /// Once the window is full (`len == WINDOW_SIZE == 50`) this is exactly
    /// `rejected_count / 50`, matching the policy wording. For a player with
    /// fewer than 50 verdicts the denominator is the actual count — so e.g. 3
    /// rejections in 10 verdicts is 30%, not 6%. Returns `0.0` for an empty
    /// window.
    pub fn rejection_rate(&self) -> f64 {
        if self.verdicts.is_empty() {
            return 0.0;
        }
        self.rejected_count() as f64 / self.len() as f64
    }

    /// Whether the window's rejection rate currently warrants a shadowban.
    ///
    /// Per policy: requires **at least** [`MIN_SUBMISSIONS`] verdicts **and** a
    /// rejection rate strictly greater than [`SHADOWBAN_THRESHOLD`].
    pub fn should_shadowban(&self) -> bool {
        self.len() >= MIN_SUBMISSIONS && self.rejection_rate() > SHADOWBAN_THRESHOLD
    }
}

/// Record a submission verdict in the player's history.
///
/// Called by the validator once a verdict (`accepted` / `rejected`) is rendered,
/// so the rolling window can be reconstructed on the next
/// [`update_shadowban_status`] call. Idempotent on `(player_uuid, submission_id)`
/// via `ON CONFLICT DO NOTHING`.
pub async fn record_submission_verdict(
    pool: &PgPool,
    player_uuid: Uuid,
    submission_id: Uuid,
    status: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO player_submission_history (player_uuid, submission_id, status)
         VALUES ($1, $2, $3)
         ON CONFLICT (player_uuid, submission_id) DO NOTHING",
    )
    .bind(player_uuid)
    .bind(submission_id)
    .bind(status)
    .execute(pool)
    .await
    .context("Failed to record submission verdict")?;

    Ok(())
}

/// Load a player's most recent verdicts as oldest-first booleans (`true` =
/// rejected), up to `limit` rows. Newest rows are selected first from the DB and
/// reversed so the caller can feed them straight into [`RollingRejectionWindow`].
/// `submission_id` breaks `created_at` ties deterministically.
async fn load_recent_verdicts(pool: &PgPool, player_uuid: Uuid, limit: usize) -> Result<Vec<bool>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT status FROM player_submission_history
         WHERE player_uuid = $1
         ORDER BY created_at DESC, submission_id DESC
         LIMIT $2",
    )
    .bind(player_uuid)
    .bind(limit as i64)
    .fetch_all(pool)
    .await
    .context("Failed to load recent verdicts")?;

    let mut verdicts: Vec<bool> = rows
        .into_iter()
        .map(|(status,)| status == "rejected")
        .collect();
    verdicts.reverse(); // oldest-first
    Ok(verdicts)
}

/// Recompute shadowban status for a player from their most recent
/// [`WINDOW_SIZE`] verdicts and flip `players.shadowbanned` if the policy
/// decision changed. A fresh ban is logged and increments the shadowban metric.
///
/// This is the trigger invoked after every verdict in `update_submission_verdict`
/// (`main.rs`): it auto-sets `shadowbanned = true` once the rejection rate
/// exceeds 20%, and lifts the ban again once the rate drops back to-or-below the
/// threshold.
pub async fn update_shadowban_status(pool: &PgPool, player_uuid: Uuid) -> Result<()> {
    let verdicts = load_recent_verdicts(pool, player_uuid, WINDOW_SIZE).await?;
    let window = RollingRejectionWindow::from_verdicts(verdicts);
    let should_ban = window.should_shadowban();

    let current: Option<bool> =
        sqlx::query_scalar("SELECT shadowbanned FROM players WHERE player_uuid = $1")
            .bind(player_uuid)
            .fetch_optional(pool)
            .await
            .context("Failed to fetch current shadowban status")?;

    match (current.unwrap_or(false), should_ban) {
        (false, true) => {
            sqlx::query("UPDATE players SET shadowbanned = true WHERE player_uuid = $1")
                .bind(player_uuid)
                .execute(pool)
                .await?;

            tracing::warn!(
                player_uuid = %player_uuid,
                rejection_rate = %window.rejection_rate(),
                rejected_count = %window.rejected_count(),
                window_size = %window.len(),
                "Player shadowbanned for exceeding 20% rejection rate"
            );

            crate::metrics::inc_shadowban();
        }
        (true, false) => {
            sqlx::query("UPDATE players SET shadowbanned = false WHERE player_uuid = $1")
                .bind(player_uuid)
                .execute(pool)
                .await?;

            tracing::info!(
                player_uuid = %player_uuid,
                rejection_rate = %window.rejection_rate(),
                "Player unshadowbanned (rejection rate at or below threshold)"
            );
        }
        _ => {
            // Status unchanged — no write needed.
        }
    }

    Ok(())
}

/// Check whether a player is currently shadowbanned.
///
/// `Ok(false)` for a player row with the flag unset (or a missing row);
/// `Ok(true)` when shadowbanned; `Err` only on a database failure.
#[allow(dead_code)]
pub async fn is_shadowbanned(pool: &PgPool, player_uuid: Uuid) -> Result<bool> {
    let shadowbanned: Option<bool> =
        sqlx::query_scalar("SELECT shadowbanned FROM players WHERE player_uuid = $1")
            .bind(player_uuid)
            .fetch_optional(pool)
            .await
            .context("Failed to check shadowban status")?;

    Ok(shadowbanned.unwrap_or(false))
}

/// Calculate the rejection rate over a player's most recent `window_size`
/// verdicts (capped at [`WINDOW_SIZE`]). `0.0` if the player has no history.
///
/// Mostly a diagnostic / monitoring helper — the ban/no-ban decision itself goes
/// through [`update_shadowban_status`] / [`RollingRejectionWindow::should_shadowban`].
#[allow(dead_code)]
pub async fn calculate_rejection_rate(
    pool: &PgPool,
    player_uuid: Uuid,
    window_size: u32,
) -> Result<f64> {
    let limit = (window_size as usize).min(WINDOW_SIZE);
    let verdicts = load_recent_verdicts(pool, player_uuid, limit).await?;
    Ok(RollingRejectionWindow::from_verdicts(verdicts).rejection_rate())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Rolling-window eviction ──────────────────────────────────────────────

    /// Headline property required by the bead: the 51st submission evicts the
    /// oldest. We make the oldest verdict the *only* rejection so its eviction
    /// shows up directly as the rejection rate collapsing to zero.
    #[test]
    fn fifty_first_verdict_evicts_oldest() {
        let mut window = RollingRejectionWindow::default();

        // 1 rejected (oldest), then 49 accepted → full window, 1 rejection.
        window.record(true);
        for _ in 0..49 {
            window.record(false);
        }
        assert_eq!(window.len(), 50);
        assert_eq!(window.rejected_count(), 1);
        assert!((window.rejection_rate() - 0.02).abs() < f64::EPSILON);

        // 51st verdict — accepted. The oldest (the lone rejection) is evicted.
        window.record(false);
        assert_eq!(window.len(), 50, "window stays capped at WINDOW_SIZE");
        assert_eq!(
            window.rejected_count(),
            0,
            "oldest rejection must have been evicted by the 51st verdict"
        );
        assert_eq!(window.rejection_rate(), 0.0);
    }

    /// Eviction is strict FIFO: after 51 alternating verdicts, exactly the first
    /// one is gone and the remaining 50 are the newest 50.
    #[test]
    fn eviction_is_fifo_oldest_first() {
        let mut window = RollingRejectionWindow::default();
        for i in 0..51 {
            window.record(i % 2 == 0); // even index = rejected
        }
        assert_eq!(window.len(), 50);
        // Index 0 was evicted; remaining indices 1..=50, of which the even ones
        // (2,4,…,50) are rejected — that is 25.
        assert_eq!(window.rejected_count(), 25);
    }

    /// `from_verdicts` keeps only the most recent WINDOW_SIZE when handed more.
    #[test]
    fn from_verdicts_caps_at_window_size() {
        // 10 rejected then 50 accepted (60 total) → window keeps the last 50
        // (all accepted), every early rejection evicted.
        let verdicts = (0..10).map(|_| true).chain((0..50).map(|_| false));
        let window = RollingRejectionWindow::from_verdicts(verdicts);
        assert_eq!(window.len(), 50);
        assert_eq!(window.rejected_count(), 0);
        assert_eq!(window.rejection_rate(), 0.0);
    }

    // ── Rate calculation ─────────────────────────────────────────────────────

    #[test]
    fn rate_is_rejected_over_window_size() {
        let mut window = RollingRejectionWindow::default();
        for _ in 0..40 {
            window.record(false);
        }
        for _ in 0..10 {
            window.record(true);
        }
        // 10 rejected of a full 50-window = exactly 0.20.
        assert!((window.rejection_rate() - 0.20).abs() < f64::EPSILON);
    }

    #[test]
    fn rate_uses_actual_count_below_window_size() {
        // 3 rejected of 10 total verdicts = 30%, NOT 3/50. This is what the
        // contract test (tests/shadowban.rs "30% rejection rate should trigger
        // shadowban") relies on.
        let verdicts = (0..7).map(|_| false).chain((0..3).map(|_| true));
        let window = RollingRejectionWindow::from_verdicts(verdicts);
        assert_eq!(window.len(), 10);
        assert!((window.rejection_rate() - 0.30).abs() < f64::EPSILON);
    }

    #[test]
    fn empty_window_is_zero_rate() {
        let window = RollingRejectionWindow::default();
        assert!(window.is_empty());
        assert_eq!(window.len(), 0);
        assert_eq!(window.rejected_count(), 0);
        assert_eq!(window.rejection_rate(), 0.0);
        assert!(!window.should_shadowban());
    }

    // ── Shadowban threshold ──────────────────────────────────────────────────

    /// Exactly 20% (the threshold) must NOT shadowban — the policy is strictly
    /// greater than 20%.
    #[test]
    fn exactly_20_percent_does_not_shadowban() {
        let verdicts = (0..40).map(|_| false).chain((0..10).map(|_| true));
        let window = RollingRejectionWindow::from_verdicts(verdicts);
        assert!((window.rejection_rate() - 0.20).abs() < f64::EPSILON);
        assert!(!window.should_shadowban());
    }

    /// Just above 20% (11/50 = 22%) must shadowban.
    #[test]
    fn above_20_percent_shadowbans() {
        let verdicts = (0..39).map(|_| false).chain((0..11).map(|_| true));
        let window = RollingRejectionWindow::from_verdicts(verdicts);
        assert!(window.rejection_rate() > 0.20);
        assert!(window.should_shadowban());
    }

    /// Fewer than MIN_SUBMISSIONS verdicts never triggers a shadowban even at a
    /// 100% rejection rate.
    #[test]
    fn below_min_submissions_never_shadowbans() {
        let window = RollingRejectionWindow::from_verdicts([true; MIN_SUBMISSIONS - 1]);
        assert_eq!(window.rejection_rate(), 1.0);
        assert!(!window.should_shadowban());
    }

    /// At exactly MIN_SUBMISSIONS, a >20% rate can shadowban.
    #[test]
    fn at_min_submissions_can_shadowban() {
        // 7 accepted + 3 rejected of 10 = 30%.
        let verdicts = (0..7).map(|_| false).chain((0..3).map(|_| true));
        let window = RollingRejectionWindow::from_verdicts(verdicts);
        assert_eq!(window.len(), MIN_SUBMISSIONS);
        assert!(window.should_shadowban());
    }

    /// Unshadowban path: a window that would ban, then drops back to-or-below
    /// threshold, flips its decision.
    #[test]
    fn dropping_below_threshold_lifts_ban() {
        let mut window = RollingRejectionWindow::default();
        for _ in 0..45 {
            window.record(false);
        }
        for _ in 0..5 {
            window.record(true);
        }
        // 5/50 = 10% — not banned.
        assert!(!window.should_shadowban());

        // Push 11 more rejections (evicting 11 accepted) → [A×34, R×16] = 16/50 = 32%.
        for _ in 0..11 {
            window.record(true);
        }
        assert!(window.should_shadowban());

        // Now drain accepted verdicts through the window. The 34 surviving
        // accepted sit at the front, so the first 34 evict *accepted* verdicts
        // and leave the rejection count untouched; only accepted verdicts
        // 35..=40 start evicting rejections. 40 total evicts 6 rejections →
        // [R×10, A×40] = exactly 0.20, which the strict-`>` policy treats as
        // "not shadowbanned" (matches exactly_20_percent_does_not_shadowban).
        for _ in 0..40 {
            window.record(false);
        }
        assert!(
            !window.should_shadowban(),
            "rejection rate dropped back to-or-below threshold: {}",
            window.rejection_rate()
        );
    }

    // ── Constants match the plan ─────────────────────────────────────────────

    #[test]
    fn constants_match_plan_policy() {
        // Plan §Multiplayer 8 Layer 3: 20% over a 50-run rolling window.
        assert_eq!(WINDOW_SIZE, 50);
        assert_eq!(MIN_SUBMISSIONS, 10);
        assert!((SHADOWBAN_THRESHOLD - 0.20).abs() < f64::EPSILON);
    }
}
