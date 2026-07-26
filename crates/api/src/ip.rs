//! TCP peer-address extraction for per-IP rate limiting.
//!
//! This is the foundation for plan §Multiplayer & Backend 8 Layer 2's
//! "Per-IP limits are keyed off the TCP remote address" requirement, and the
//! unblocker for the long-standing TODO in `handlers/identity.rs`.
//!
//! ## Trust model (plan §Multiplayer & Backend 1 — "API DNS policy")
//!
//! The `api.*` vhost is **DNS-only at Cloudflare (orange-cloud OFF)**: requests
//! hit Traefik on the Rackspace Spot cluster directly over the public internet.
//! There is no trusted proxy in front of this server, so
//! [`X-Forwarded-For`], [`X-Real-IP`], and [`CF-Connecting-IP`] are
//! **attacker-controlled input** here and are **deliberately ignored**.
//!
//! The rate-limit key is the TCP peer address and nothing else. Trusting a
//! forwarded header on this vhost would let a single client spoof an unbounded
//! set of "distinct" IPs and trivially bypass any per-IP limit.
//!
//! This invariant is enforced by construction: [`peer_ip`] takes only a
//! [`ConnectInfo<SocketAddr>`] and has no access to request headers at all, so
//! it is *impossible* for a header value to reach the rate limiter through it.
//!
//! [`X-Forwarded-For`]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For
//! [`ConnectInfo<SocketAddr>`]: axum::extract::ConnectInfo

use axum::extract::ConnectInfo;
use std::net::{IpAddr, SocketAddr};

/// Extract the real TCP peer address for per-IP rate limiting.
///
/// Reads only the [`ConnectInfo<SocketAddr>`] the axum runtime injects from the
/// accepted TCP connection. It does **not** consult `X-Forwarded-For`,
/// `X-Real-IP`, or `CF-Connecting-IP` — see the module docs for why those are
/// untrusted on this vhost.
///
/// [`ConnectInfo<SocketAddr>`]: axum::extract::ConnectInfo
pub fn peer_ip(ConnectInfo(addr): ConnectInfo<SocketAddr>) -> IpAddr {
    addr.ip()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn returns_real_ipv4_peer() {
        let info = ConnectInfo(SocketAddr::from(([203, 0, 113, 7], 42000)));
        assert_eq!(peer_ip(info), IpAddr::V4(Ipv4Addr::new(203, 0, 113, 7)));
    }

    #[test]
    fn returns_real_ipv6_peer() {
        let addr = SocketAddr::from(([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1], 443));
        assert_eq!(
            peer_ip(ConnectInfo(addr)),
            IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1))
        );
    }

    #[test]
    fn port_is_not_part_of_the_identity() {
        // Same IP, two different source ports → same rate-limit key.
        let a = ConnectInfo(SocketAddr::from(([198, 51, 100, 42], 1)));
        let b = ConnectInfo(SocketAddr::from(([198, 51, 100, 42], 65_535)));
        assert_eq!(peer_ip(a), peer_ip(b));
    }

    // NOTE: there is intentionally no test passing a HeaderMap here. The helper
    // cannot accept headers — its signature forbids it. That compile-time
    // guarantee is what keeps a forwarded-header value out of the rate limiter;
    // the integration test in tests/connect_info_test.rs proves the same thing
    // end-to-end against a real `axum::serve` connection carrying spoofed
    // X-Forwarded-For / X-Real-IP / CF-Connecting-IP headers.
}
