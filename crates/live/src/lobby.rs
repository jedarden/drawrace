//! Lobby system for live racing
//!
//! Players wait in pools partitioned by track and bucket.
//! Based on plan §Multiplayer & Backend 13:
//! - "Matchmaker gains a 'live' mode: puts player in waiting pool partitioned by bucket"
//! - "After timeout (say 8s), fill empty slots with ghosts"

use anyhow::Result;
use redis::AsyncCommands;
use uuid::Uuid;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::messages::LobbyPlayer;

/// Lobby configuration
pub const LOBBY_TIMEOUT_SECS: u64 = 8;
/// Minimum players to start a live race (otherwise fill with ghosts)
pub const MIN_LIVE_PLAYERS: usize = 2;
/// Maximum players per room
pub const MAX_PLAYERS_PER_ROOM: usize = 8;
/// Lobby pool TTL (auto-cleanup abandoned players)
pub const LOBBY_POOL_TTL: usize = 300; // 5 minutes

/// Add player to lobby pool
pub async fn add_to_lobby(
    redis: &mut redis::aio::ConnectionManager,
    track_id: u16,
    bucket: &str,
    player: &LobbyPlayer,
) -> Result<()> {
    let key = lobby_key(track_id, bucket);
    let now = now_ms();
    let value = serde_json::to_string(player)?;

    // Add to sorted set with score = join time
    redis::cmd("ZADD")
        .arg(&key)
        .arg(now)
        .arg(&value)
        .query_async::<_, ()>(redis)
        .await?;

    // Set TTL on the key
    redis::cmd("EXPIRE")
        .arg(&key)
        .arg(LOBBY_POOL_TTL)
        .query_async::<_, ()>(redis)
        .await?;

    // Increment gauge for monitoring
    metrics::gauge!("drawrace_lobby_size", "track_id" => track_id.to_string(), "bucket" => bucket)
        .increment(1.0);

    Ok(())
}

/// Remove player from lobby pool
pub async fn remove_from_lobby(
    redis: &mut redis::aio::ConnectionManager,
    track_id: u16,
    bucket: &str,
    player_uuid: Uuid,
) -> Result<()> {
    let key = lobby_key(track_id, bucket);

    // We need to find and remove the specific player entry
    // Since we stored JSON strings, we need to scan for the player_uuid
    let members: Vec<String> = redis::cmd("ZRANGE")
        .arg(&key)
        .arg(0)
        .arg(-1)
        .query_async::<_, Vec<String>>(redis)
        .await?;

    for member in members {
        if let Ok(player) = serde_json::from_str::<LobbyPlayer>(&member) {
            if player.player_uuid == player_uuid {
                redis::cmd("ZREM")
                    .arg(&key)
                    .arg(&member)
                    .query_async::<_, ()>(redis)
                    .await?;
                break;
            }
        }
    }

    Ok(())
}

/// Get lobby size for a track/bucket
pub async fn lobby_size(
    redis: &mut redis::aio::ConnectionManager,
    track_id: u16,
    bucket: &str,
) -> Result<usize> {
    let key = lobby_key(track_id, bucket);
    let size: usize = redis::cmd("ZCARD")
        .arg(&key)
        .query_async::<_, usize>(redis)
        .await?;
    Ok(size)
}

/// Pop N players from lobby pool (for room creation)
///
/// This removes players from the lobby pool as they're assigned to a room.
pub async fn pop_players_from_lobby(
    redis: &mut redis::aio::ConnectionManager,
    track_id: u16,
    bucket: &str,
    count: usize,
) -> Result<Vec<LobbyPlayer>> {
    let key = lobby_key(track_id, bucket);

    // Get oldest N players (lowest scores = earliest join times)
    let members: Vec<String> = redis::cmd("ZRANGE")
        .arg(&key)
        .arg(0)
        .arg(count as i64 - 1)
        .query_async::<_, Vec<String>>(redis)
        .await?;

    let mut players = Vec::with_capacity(members.len());
    for member in &members {
        let player = serde_json::from_str::<LobbyPlayer>(member)?;
        players.push(player);
    }

    // Remove them from the pool
    if !members.is_empty() {
        redis::cmd("ZREM")
            .arg(&key)
            .arg(members.len())
            .query_async::<_, ()>(redis)
            .await?;
    }

    Ok(players)
}

/// Check if lobby has enough players to start a room
pub async fn can_start_room(
    redis: &mut redis::aio::ConnectionManager,
    track_id: u16,
    bucket: &str,
) -> Result<bool> {
    let size = lobby_size(redis, track_id, bucket).await?;
    Ok(size >= MIN_LIVE_PLAYERS)
}

/// Clean up expired lobby entries
///
/// This should be run periodically to remove players who joined but never connected.
pub async fn cleanup_expired_entries(
    redis: &mut redis::aio::ConnectionManager,
    track_id: u16,
    bucket: &str,
    timeout_secs: u64,
) -> Result<usize> {
    let key = lobby_key(track_id, bucket);
    let cutoff = now_ms() - (timeout_secs * 1000) as i64;

    let removed: usize = redis::cmd("ZREMRANGEBYSCORE")
        .arg(&key)
        .arg(0)
        .arg(cutoff)
        .query_async::<_, usize>(redis)
        .await?;

    Ok(removed)
}

fn lobby_key(track_id: u16, bucket: &str) -> String {
    format!("lobby:{}:{}", track_id, bucket)
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lobby_key() {
        assert_eq!(lobby_key(1, "elite"), "lobby:1:elite");
        assert_eq!(lobby_key(42, "novice"), "lobby:42:novice");
    }
}
