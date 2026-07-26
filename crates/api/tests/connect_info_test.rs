//! Contract test: `ConnectInfo<SocketAddr>` is wired into the axum serve path
//! and yields the real TCP peer address, ignoring forwarded headers.
//!
//! This is the foundation for per-IP rate limiting (plan §Multiplayer & Backend
//! 1 "API DNS policy" + §Multiplayer & Backend 8 Layer 2). The `api.*` vhost is
//! DNS-only at Cloudflare (orange-cloud OFF), so no trusted proxy sits in front
//! of the server — `X-Forwarded-For` / `X-Real-IP` / `CF-Connecting-IP` are
//! attacker-controlled here and MUST NOT influence the rate-limit key.
//!
//! This test needs no Postgres/Redis/S3: it binds an ephemeral listener, serves
//! a minimal router (whose handler uses the real `ip::peer_ip` helper), connects
//! over a real loopback TCP connection carrying spoofed forwarded headers, and
//! asserts the handler sees `127.0.0.1` (the actual TCP peer), not any header
//! value.

use axum::{extract::ConnectInfo, routing::get, Router};
use drawrace_api::ip::peer_ip;
use std::net::SocketAddr;

/// Echoes the real TCP peer IP via the same helper handlers will use.
async fn whoami(info: ConnectInfo<SocketAddr>) -> String {
    peer_ip(info).to_string()
}

#[tokio::test]
async fn handler_sees_real_tcp_peer_not_forwarded_headers() {
    let app = Router::new().route("/whoami", get(whoami));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    // Serve with the exact wiring now used in main.rs.
    let server = tokio::spawn(async move {
        let _ = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await;
    });

    let url = format!("http://127.0.0.1:{}/whoami", addr.port());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();

    let resp = client
        .get(&url)
        // All three forwarded headers carry a value that is NOT the TCP peer.
        .header("X-Forwarded-For", "1.2.3.4")
        .header("X-Real-IP", "5.6.7.8")
        .header("CF-Connecting-IP", "9.10.11.12")
        .send()
        .await
        .expect("request to ephemeral server should succeed");

    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let body = resp.text().await.unwrap();

    // The real TCP peer on IPv4 loopback is 127.0.0.1.
    assert_eq!(body, "127.0.0.1");
    // …and definitely not any of the spoofed forwarded-header values.
    assert_ne!(body, "1.2.3.4");
    assert_ne!(body, "5.6.7.8");
    assert_ne!(body, "9.10.11.12");

    server.abort();
}
