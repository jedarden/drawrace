//! Background tasks for live racing
//!
//! Handles lobby management and room lifecycle.

use anyhow::{Context, Result};
use redis::AsyncCommands;
use std::time::Duration;
use tokio::time::interval;
use uuid::Uuid;

use crate::app::LiveState;
use crate::lobby::{self, LOBBY_TIMEOUT_SECS, MIN_LIVE_PLAYERS, MAX_PLAYERS_PER_ROOM};
use crate::messages::{PlayerInRoom, RoomStatus, LobbyPlayer};
use crate::room;

/// Run the lobby background task
///
/// This task runs periodically to:
/// 1. Check lobby pools for players ready to race
/// 2. Create rooms when enough players are available
/// 3. Fill empty slots with ghosts after timeout
/// 4. Clean up expired lobby entries
pub async fn run_lobby_task(state: &LiveState) {
    let mut ticker = interval(Duration::from_secs(1));

    loop {
        ticker.tick().await;

        if let Err(e) = process_lobbies(state).await {
            tracing::error!("Error processing lobbies: {}", e);
        }
    }
}

async fn process_lobbies(state: &LiveState) -> Result<()> {
    // Get all lobby keys (pattern: lobby:{track_id}:{bucket})
    let mut redis_mgr = state.redis_mgr.lock().await;
    let keys: Vec<String> = redis::cmd("KEYS")
        .arg("lobby:*")
        .query_async(&mut *redis_mgr)
        .await?;

    for key in keys {
        if let Err(e) = process_lobby_key(state, &key, &mut *redis_mgr).await {
            tracing::error!("Error processing lobby {}: {}", key, e);
        }
    }

    Ok(())
}

async fn process_lobby_key(
    state: &LiveState,
    key: &str,
    redis_mgr: &mut redis::aio::ConnectionManager,
) -> Result<()> {
    // Parse key to get track_id and bucket
    // Format: lobby:{track_id}:{bucket}
    let parts: Vec<&str> = key.split(':').collect();
    if parts.len() != 3 {
        return Ok(()); // Skip invalid keys
    }

    let track_id: u16 = parts[1].parse()
        .unwrap_or(1);
    let bucket = parts[2];

    // Clean up expired entries
    let removed = lobby::cleanup_expired_entries(redis_mgr, track_id, bucket, LOBBY_TIMEOUT_SECS + 60).await?;
    if removed > 0 {
        tracing::debug!(track_id, bucket, removed, "Cleaned up expired lobby entries");
    }

    // Check lobby size
    let size = lobby::lobby_size(redis_mgr, track_id, bucket).await?;
    if size < MIN_LIVE_PLAYERS {
        return Ok(()); // Not enough players yet
    }

    // Pop players for a new room
    let player_count = size.min(MAX_PLAYERS_PER_ROOM);
    let players = lobby::pop_players_from_lobby(redis_mgr, track_id, bucket, player_count).await?;

    // Create a new room
    let room_id = Uuid::new_v4();
    let pod_ip = state.pod_ip.clone();

    let mut room = state.rooms.create(room_id, track_id, pod_ip).await;

    // Add players to the room
    for player in &players {
        room.add_player(PlayerInRoom {
            player_uuid: player.player_uuid,
            name: player.name.clone(),
            ready: false,
            wheel: None,
        });
    }

    // Calculate race start time (after timeout for ghosts)
    let now_ms = crate::lobby::now_ms();
    let start_time_ms = now_ms + (LOBBY_TIMEOUT_SECS as i64 * 1000);

    // Start countdown
    room.start_countdown(start_time_ms);

    // Update room in registry
    state.rooms.update(room_id, |r| {
        r.start_countdown(start_time_ms);
    }).await?;

    // Register room in Redis
    room::register_room_in_redis(redis_mgr, &room).await?;

    // Fill remaining slots with ghosts if needed
    let live_players = players.len();
    if live_players < MAX_PLAYERS_PER_ROOM {
        let ghost_count = MAX_PLAYERS_PER_ROOM - live_players;

        // TODO: Fetch ghosts from ghost blob service
        // For now, we just note that ghosts will be added
        tracing::info!(
            room_id = %room_id,
            live_players,
            ghost_count,
            "Room created, will add ghosts"
        );
    }

    // Broadcast race start to players
    // Note: Players will connect via WebSocket after getting room assignment
    tracing::info!(
        room_id = %room_id,
        track_id,
        bucket,
        players = live_players,
        "Created new room from lobby"
    );

    // Increment counter
    metrics::counter!("drawrace_rooms_created").increment(1);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_lobby_key() {
        let key = "lobby:42:elite";
        let parts: Vec<&str> = key.split(':').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[1], "42");
        assert_eq!(parts[2], "elite");
    }
}
