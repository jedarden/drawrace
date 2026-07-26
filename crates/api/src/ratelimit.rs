//! Reusable Redis rate-limit primitive.
//!
//! Extracts the `INCR` + EXPIRE-on-first + TTL-for-retry-after pattern that was
//! duplicated — and had drifted — across three call sites:
//!
//! - `handlers::names::post_name` (per-UUID name claims)
//! - `handlers::submissions::post_submission` (per-UUID *and* per-IP submission
//!   writes)
//! - `handlers::submissions::get_submission` (per-UUID verdict polls)
//!
//! All three are migrated onto [`check_rate_limit`] by children #3 and #4 of the
//! umbrella bead (`bf-4qeyz`). This child (#1) only introduces the primitive and
//! its unit tests; it does not touch any handler.

/// The outcome of a [`check_rate_limit`] call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RateLimitOutcome {
    /// `true` when the caller is within the allowed budget (`count <= max`) for
    /// the current window.
    pub allowed: bool,
    /// Seconds a rate-limited client should wait before retrying. Only
    /// meaningful when [`allowed`](Self::allowed) is `false`. Derived from the
    /// counter key's remaining TTL, falling back to the full window via
    /// [`retry_after_seconds`]. Zero when the request is allowed.
    pub retry_after_secs: u64,
}

/// Seconds to tell a rate-limited client to wait before retrying. Uses the
/// counter key's remaining TTL when it is positive; falls back to the full
/// window when the TTL is missing or non-positive (key absent → Redis returns
/// `-2`, key present but no expiry → Redis returns `-1`, or a `0`/errored TTL
/// lookup).
///
/// Factored out as a pure function so it is testable without Redis. This
/// supersedes the private copy in `handlers::submissions::retry_after_seconds`
/// (child #4 switches that site onto it).
pub fn retry_after_seconds(ttl_seconds: i64, window_seconds: i64) -> i64 {
    if ttl_seconds > 0 {
        ttl_seconds
    } else {
        window_seconds
    }
}

/// Check a fixed-window rate limit backed by a Redis counter.
///
/// Behavior mirrors the existing call sites:
///
/// 1. `INCR` on the key `{namespace}:{key}`. When the returned count is `1`,
///    `EXPIRE` the key to `window_secs` so the window resets.
/// 2. `allowed = count <= max`.
/// 3. `retry_after_secs` comes from the key's TTL via [`retry_after_seconds`]
///    (falling back to the full window when the TTL is missing/non-positive).
///
/// On Redis errors the function degrades exactly like the existing code: an
/// `INCR` failure is treated as a count that allows (`count = 0`), and it never
/// panics. This keeps a Redis hiccup from taking the write path down — the worst
/// case is a temporarily unenforced limit, never a hard outage.
///
/// `namespace` is a short bucket prefix (e.g. `"rl:submit"`, `"rl:poll"`,
/// `"rl:name"`) and `key` is the per-caller identifier (UUID, IP). They are
/// joined with `:` so the on-disk key matches the existing `rl:submit:{uuid}`
/// / `rl:poll:{uuid}` / `rl:name:{uuid}` layout exactly.
pub async fn check_rate_limit(
    conn: &mut impl redis::aio::ConnectionLike,
    namespace: &str,
    key: &str,
    max: i64,
    window_secs: i64,
) -> RateLimitOutcome {
    let rl_key = format!("{namespace}:{key}");

    // INCR — on failure, degrade to "allow" (treat the count as 0), never panic.
    let count: i64 = redis::cmd("INCR")
        .arg(&rl_key)
        .query_async(conn)
        .await
        .unwrap_or(0);

    // EXPIRE the window on the first hit so the counter eventually resets.
    if count == 1 {
        let _: () = redis::cmd("EXPIRE")
            .arg(&rl_key)
            .arg(window_secs)
            .query_async(conn)
            .await
            .unwrap_or(());
    }

    let allowed = count <= max;

    let retry_after_secs = if allowed {
        0
    } else {
        // The key's TTL is the precise remaining window; fall back to the full
        // window when the TTL is missing/non-positive or the lookup errored.
        let ttl: i64 = redis::cmd("TTL")
            .arg(&rl_key)
            .query_async(conn)
            .await
            .unwrap_or(-1);
        let secs = retry_after_seconds(ttl, window_secs);
        // Windows are always positive in practice; clamp defensively so a
        // misconfigured window can never underflow the `u64` field.
        secs.max(0) as u64
    };

    RateLimitOutcome {
        allowed,
        retry_after_secs,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // retry_after_seconds — the only Redis-free logic, so it gets the unit tests.
    // (See child #1 acceptance criteria.)
    // -------------------------------------------------------------------------

    #[test]
    fn positive_ttl_passes_through() {
        assert_eq!(retry_after_seconds(30, 60), 30);
        assert_eq!(retry_after_seconds(1, 60), 1);
        // A TTL larger than the window is unusual but still authoritative.
        assert_eq!(retry_after_seconds(120, 60), 120);
    }

    #[test]
    fn zero_ttl_falls_back_to_window() {
        // TTL of 0 is not a value Redis returns for EXPIRE'd keys, but if a
        // lookup or arithmetic ever yields 0 we treat it as "no usable TTL".
        assert_eq!(retry_after_seconds(0, 60), 60);
    }

    #[test]
    fn negative_ttl_falls_back_to_window() {
        // -1 = key exists but has no expiry set; -2 = key does not exist.
        assert_eq!(retry_after_seconds(-1, 60), 60);
        assert_eq!(retry_after_seconds(-2, 60), 60);
        // Same behaviour regardless of the window size.
        assert_eq!(retry_after_seconds(-1, 3), 3);
    }

    // -------------------------------------------------------------------------
    // check_rate_limit — exercised against an in-memory mock of the async Redis
    // connection, so the INCR / EXPIRE-on-first / TTL-for-retry-after behaviour
    // is unit-tested without a live Redis (child #1 acceptance criteria).
    // -------------------------------------------------------------------------

    /// In-memory mock of [`redis::aio::ConnectionLike`]. It speaks just enough
    /// of the protocol for `check_rate_limit`:
    /// - `INCR <key>` returns the running count (the value `allowed` keys on);
    /// - `EXPIRE <key> <secs>` records the window TTL (fired by
    ///   `check_rate_limit` only when it observed `count == 1`);
    /// - `TTL <key>` replays the recorded TTL, the input to `retry_after`.
    ///
    /// Per-key state is retained across calls, mirroring what a real Redis
    /// holds for the lifetime of a window.
    struct MockRedis {
        counts: std::collections::HashMap<String, i64>,
        ttls: std::collections::HashMap<String, i64>,
    }

    impl MockRedis {
        fn new() -> Self {
            MockRedis {
                counts: Default::default(),
                ttls: Default::default(),
            }
        }
    }

    impl redis::aio::ConnectionLike for MockRedis {
        fn req_packed_command<'a>(
            &'a mut self,
            cmd: &'a redis::Cmd,
        ) -> redis::RedisFuture<'a, redis::Value> {
            // Collect the command's args (name + key + value…) up front as owned
            // Strings, so the returned future only borrows `self`.
            let args: Vec<String> = cmd
                .args_iter()
                .map(|a| match a {
                    redis::Arg::Simple(bytes) => String::from_utf8_lossy(bytes).into_owned(),
                    redis::Arg::Cursor => String::new(),
                })
                .collect();
            Box::pin(async move {
                let name = args.first().map(String::as_str).unwrap_or("");
                let key = args.get(1).cloned().unwrap_or_default();
                match name {
                    "INCR" => {
                        let count = self.counts.entry(key.clone()).or_insert(0);
                        *count += 1;
                        Ok(redis::Value::Int(*count))
                    }
                    "EXPIRE" => {
                        let secs: i64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
                        self.ttls.insert(key, secs);
                        Ok(redis::Value::Int(1))
                    }
                    "TTL" => {
                        // Real Redis returns -2 for a missing key and -1 for a
                        // key with no expiry; we record only what EXPIRE set.
                        let ttl = self.ttls.get(&key).copied().unwrap_or(-2);
                        Ok(redis::Value::Int(ttl))
                    }
                    other => Err(redis::RedisError::from((
                        redis::ErrorKind::ResponseError,
                        "MockRedis: unexpected command",
                        other.to_string(),
                    ))),
                }
            })
        }

        fn req_packed_commands<'a>(
            &'a mut self,
            _cmd: &'a redis::Pipeline,
            _offset: usize,
            _count: usize,
        ) -> redis::RedisFuture<'a, Vec<redis::Value>> {
            // `check_rate_limit` issues each command separately (no pipelining),
            // so this is never reached — fail loudly if it ever is.
            Box::pin(async {
                Err(redis::RedisError::from((
                    redis::ErrorKind::ResponseError,
                    "MockRedis: pipelined commands not supported",
                )))
            })
        }

        fn get_db(&self) -> i64 {
            0
        }
    }

    #[tokio::test]
    async fn first_call_allowed_with_ttl_set() {
        // max=3, window=60s. The first call INCRs to count=1 — within budget
        // (allowed) — and, because count == 1, fires EXPIRE so the window is
        // recorded. retry_after is 0 because the request was allowed.
        let mut conn = MockRedis::new();
        let outcome = check_rate_limit(&mut conn, "rl:test", "alice", 3, 60).await;
        assert!(outcome.allowed, "count=1 must be within a max=3 budget");
        assert_eq!(outcome.retry_after_secs, 0);

        // INCR ran on the joined key `{namespace}:{key}`.
        assert_eq!(conn.counts.get("rl:test:alice"), Some(&1));
        // EXPIRE recorded the window for this key only.
        assert_eq!(conn.ttls.get("rl:test:alice"), Some(&60));
    }

    #[tokio::test]
    async fn expire_fires_only_on_first_hit() {
        // EXPIRE must run exactly once — on the count==1 hit — never on later
        // hits in the same window, so the window is not reset per request.
        let mut conn = MockRedis::new();
        check_rate_limit(&mut conn, "rl:test", "bob", 3, 42).await; // count=1 → EXPIRE
        check_rate_limit(&mut conn, "rl:test", "bob", 3, 99).await; // count=2 → no EXPIRE
                                                                    // The recorded TTL is the *first* window, not the second call's.
        assert_eq!(
            conn.ttls.get("rl:test:bob"),
            Some(&42),
            "EXPIRE must fire only on count==1, keeping the first window"
        );
    }

    #[tokio::test]
    async fn max_plus_one_call_rejected_with_retry_after() {
        // max=3, window=60s. The first 3 calls are allowed; the 4th (max+1) is
        // rejected with a positive retry_after derived from the key's TTL.
        let mut conn = MockRedis::new();
        for i in 1..=3 {
            let outcome = check_rate_limit(&mut conn, "rl:test", "carol", 3, 60).await;
            assert!(outcome.allowed, "call #{i} (within budget) must be allowed");
            assert_eq!(
                outcome.retry_after_secs, 0,
                "allowed calls report no retry-after"
            );
        }
        let rejected = check_rate_limit(&mut conn, "rl:test", "carol", 3, 60).await;
        assert!(!rejected.allowed, "the (max+1)th call must be rejected");
        assert!(
            rejected.retry_after_secs > 0,
            "a rejected call must carry a positive retry-after, got {}",
            rejected.retry_after_secs
        );
        // The TTL was set on the first hit, so retry_after equals the window.
        assert_eq!(rejected.retry_after_secs, 60);
    }
}
