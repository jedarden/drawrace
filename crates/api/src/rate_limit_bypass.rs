//! Staging-only per-IP rate-limit bypass allowlist (plan §Multiplayer & Backend
//! 8 Layer 2).
//!
//! The k6 load test (plan §Testing 9 Layer 8) ramps to 2000 RPS from a single
//! runner IP and would self-trip the per-IP submission limit
//! ([`SUBMIT_RATE_LIMIT_PER_IP_MAX`](crate::handlers::submissions::SUBMIT_RATE_LIMIT_PER_IP_MAX))
//! within the first second. In **staging only**, an allowlist of CIDRs
//! (`DRAWRACE_RATE_LIMIT_BYPASS_CIDR`) lets matching TCP peers skip the per-IP
//! limit. The per-UUID limits are unaffected — the bypass is per-IP only.
//!
//! ## Inert in production
//!
//! The bypass is gated on `DRAWRACE_ENV == "staging"`. In any other deployment
//! (production, development, unset), `DRAWRACE_RATE_LIMIT_BYPASS_CIDR` is
//! **never consulted**: [`RateLimitBypass::from_env`] returns an empty allowlist
//! for any non-staging env regardless of whether the CIDR var is set, and
//! [`RateLimitBypass::should_bypass`] then always returns `false`. This is
//! enforced by the staging gate inside `from_env`; `main.rs` additionally avoids
//! *reading* the CIDR var at all outside staging, so there is no env-read effect
//! in production. The deployment manifest hardcodes `DRAWRACE_ENV` from the
//! namespace (production → `drawrace`, staging → `drawrace-staging`), so a
//! production deploy cannot accidentally opt in.

use ipnet::IpNet;
use std::net::IpAddr;

/// The single `DRAWRACE_ENV` value that activates the bypass. Compared exactly
/// (case- and whitespace-sensitive) — the value originates from the deployment
/// manifest (derived from the namespace), not from user input, so an exact
/// match is the safe choice.
pub const STAGING_ENV: &str = "staging";

/// Parsed per-IP rate-limit bypass allowlist. Immutable after construction.
///
/// Construct via [`RateLimitBypass::from_env`] (the production path in
/// `main.rs`) or [`RateLimitBypass::from_cidrs`] (tests / direct injection). An
/// empty allowlist — the production / non-staging state — bypasses nothing.
#[derive(Debug, Clone)]
pub struct RateLimitBypass {
    cidrs: Vec<IpNet>,
}

impl RateLimitBypass {
    /// An allowlist that bypasses nothing — the production / non-staging state.
    pub fn empty() -> Self {
        Self { cidrs: Vec::new() }
    }

    /// Build an allowlist from already-parsed CIDRs. Used by tests.
    pub fn from_cidrs(cidrs: impl IntoIterator<Item = IpNet>) -> Self {
        Self {
            cidrs: cidrs.into_iter().collect(),
        }
    }

    /// Build the allowlist from the process environment.
    ///
    /// `env` is the value of `DRAWRACE_ENV`; `cidr_var` is the raw value of
    /// `DRAWRACE_RATE_LIMIT_BYPASS_CIDR` (comma-separated CIDRs). The CIDR var
    /// is consulted **only** when `env == "staging"`; for any other value
    /// (including `None`) the result is an empty allowlist. Callers in
    /// production should additionally avoid *reading* the CIDR var at all (see
    /// `main.rs`) so there is no env-read effect outside staging — but this gate
    /// makes the bypass inert even if the var is read and passed in.
    pub fn from_env(env: Option<String>, cidr_var: Option<String>) -> Self {
        if env.as_deref() != Some(STAGING_ENV) {
            return Self::empty();
        }
        match cidr_var {
            None => Self::empty(),
            Some(raw) => Self::from_cidr_str(&raw),
        }
    }

    /// Parse a comma-separated CIDR list. Empty entries are skipped; malformed
    /// entries are logged (best-effort) and skipped rather than failing the
    /// whole allowlist, so one bad value can't silently disable rate limiting.
    pub fn from_cidr_str(raw: &str) -> Self {
        let cidrs = raw
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .filter_map(|s| match s.parse::<IpNet>() {
                Ok(net) => Some(net),
                Err(e) => {
                    tracing::warn!(
                        cidr = %s, error = %e,
                        "ignoring malformed DRAWRACE_RATE_LIMIT_BYPASS_CIDR entry"
                    );
                    None
                }
            })
            .collect();
        Self { cidrs }
    }

    /// True iff the per-IP limit should be skipped for `ip`. Always `false`
    /// when the allowlist is empty (non-staging / production).
    ///
    /// `IpNet::contains` is an inherent method on ipnet 2.12 whose trait bound
    /// (`Contains<&IpAddr>`) is crate-private, so it is invoked without an
    /// explicit trait import. The argument is the `&IpAddr` reference directly
    /// — ipnet 2.12 implements `Contains<&IpAddr>`, not `Contains<IpAddr>`.
    pub fn should_bypass(&self, ip: &IpAddr) -> bool {
        self.cidrs.iter().any(|net| net.contains(ip))
    }

    /// Number of parsed CIDRs in the allowlist.
    pub fn len(&self) -> usize {
        self.cidrs.len()
    }

    /// True when no CIDRs are allowlisted (the inert / production state).
    pub fn is_empty(&self) -> bool {
        self.cidrs.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    /// A helper IP in the 198.51.100.0/24 TEST-NET-2 range (reserved for docs,
    /// so it can never collide with a real peer).
    fn v4(last_octet: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(198, 51, 100, last_octet))
    }

    #[test]
    fn empty_bypass_never_bypasses() {
        let b = RateLimitBypass::empty();
        assert!(b.is_empty());
        assert_eq!(b.len(), 0);
        assert!(!b.should_bypass(&v4(7)));
    }

    // ---------------------------------------------------------------------
    // Staging gate — the security-critical property (acceptance criterion 2).
    // ---------------------------------------------------------------------

    #[test]
    fn from_env_staging_populates_allowlist() {
        let b = RateLimitBypass::from_env(Some("staging".into()), Some("198.51.100.0/24".into()));
        // IP inside the CIDR → bypass active.
        assert!(b.should_bypass(&v4(7)));
        assert!(!b.is_empty());
    }

    #[test]
    fn from_env_production_ignores_cidr_var_even_when_set() {
        // Acceptance criterion: DRAWRACE_ENV=production → DRAWRACE_RATE_LIMIT_BYPASS_CIDR
        // is not consulted; the allowlist is empty and nothing is bypassed,
        // even though the CIDR var is set and *would* match the IP.
        let b =
            RateLimitBypass::from_env(Some("production".into()), Some("198.51.100.0/24".into()));
        assert!(b.is_empty());
        assert!(!b.should_bypass(&v4(7)));
    }

    #[test]
    fn from_env_non_staging_values_are_all_inert() {
        let cidr = Some("198.51.100.0/24".into());
        let cases: [Option<&str>; 6] = [
            None,     // unset
            Some(""), // empty
            Some("development"),
            Some("Staging"),  // wrong case
            Some("staging "), // trailing space
            Some("prod"),
        ];
        for env in cases {
            let b = RateLimitBypass::from_env(env.map(str::to_owned), cidr.clone());
            assert!(
                b.is_empty(),
                "env {:?} must be inert (exact 'staging' match only)",
                env
            );
            assert!(!b.should_bypass(&v4(7)), "env {:?} must not bypass", env);
        }
    }

    #[test]
    fn from_env_staging_without_cidr_var_is_empty() {
        let b = RateLimitBypass::from_env(Some("staging".into()), None);
        assert!(b.is_empty());
    }

    // ---------------------------------------------------------------------
    // CIDR containment — acceptance criterion 1 (IP in list → bypass).
    // ---------------------------------------------------------------------

    #[test]
    fn bypass_matches_ip_inside_cidr_and_rejects_outside() {
        let b = RateLimitBypass::from_cidr_str("198.51.100.0/24");
        assert!(b.should_bypass(&v4(0)));
        assert!(b.should_bypass(&v4(255)));
        assert!(!b.should_bypass(&IpAddr::V4(Ipv4Addr::new(198, 51, 101, 1))));
        assert_eq!(b.len(), 1);
    }

    #[test]
    fn bypass_matches_any_cidr_in_a_list() {
        let b = RateLimitBypass::from_cidr_str("198.51.100.42/32, 203.0.113.0/24");
        assert!(b.should_bypass(&v4(42)));
        assert!(b.should_bypass(&IpAddr::V4(Ipv4Addr::new(203, 0, 113, 200))));
        assert!(!b.should_bypass(&v4(7)));
        assert_eq!(b.len(), 2);
    }

    #[test]
    fn bypass_supports_ipv6() {
        let b = RateLimitBypass::from_cidr_str("2001:db8::/32");
        let inside = IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb8, 1, 2, 3, 4, 5, 6));
        let outside = IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb9, 0, 0, 0, 0, 0, 1));
        assert!(b.should_bypass(&inside));
        assert!(!b.should_bypass(&outside));
    }

    #[test]
    fn malformed_entries_are_skipped_good_ones_kept() {
        let b = RateLimitBypass::from_cidr_str(
            "not-a-cidr, 198.51.100.0/24, 999.999.999.999, , 203.0.113.5/32",
        );
        assert_eq!(b.len(), 2, "only the two valid CIDRs survive");
        assert!(b.should_bypass(&v4(10)));
        assert!(b.should_bypass(&IpAddr::V4(Ipv4Addr::new(203, 0, 113, 5))));
    }

    #[test]
    fn empty_and_whitespace_only_cidr_var_is_inert() {
        assert!(RateLimitBypass::from_cidr_str("").is_empty());
        assert!(RateLimitBypass::from_cidr_str("   ,  , ").is_empty());
    }
}
