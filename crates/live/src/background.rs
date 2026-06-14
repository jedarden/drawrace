//! Background tasks for live racing
//!
//! Handles lobby management and room lifecycle.

use anyhow::Result;
use std::time::Duration;
use tokio::time::{interval, MissedTickBehavior};
use uuid::Uuid;

use crate::app::LiveState;
use crate::ghost::GhostBackfill;
use crate::lobby::{self, LOBBY_TIMEOUT_SECS, MAX_PLAYERS_PER_ROOM, MIN_LIVE_PLAYERS};
use crate::messages::{PlayerInRoom, ServerMessage};
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
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        ticker.tick().await;

        if let Err(e) = process_lobbies(state).await {
            tracing::error!("Error processing lobbies: {}", e);
        }
    }
}

/// Run the race execution loop
///
/// Per plan §Multiplayer & Backend 13:
/// - "State sync rate: 20–30 Hz with client-side interpolation"
/// - "Each tick broadcasts {racer_id, x, y, angle, t} for 2–8 racers"
///
/// This runs at 30 Hz (33ms per tick) and broadcasts state to all players.
pub async fn run_race_loop(state: &LiveState) {
    let mut ticker = interval(Duration::from_millis(33)); // ~30 Hz
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        ticker.tick().await;

        let updates = state.race_executor.step_all().await;

        for (room_id, racer_states) in updates {
            // Broadcast state to all players in the room
            let tick = racer_states
                .first()
                .map(|s| s.t_ms / 16) // Approximate tick from ms
                .unwrap_or(0);

            let msg = ServerMessage::State {
                tick,
                racers: racer_states,
            };

            if let Err(e) = state.connections.broadcast(room_id, &msg).await {
                tracing::error!("Failed to broadcast state for room {}: {}", room_id, e);
            }

            // Check if race is finished
            if let Some(finish_times) = state.race_executor.get_finish_times(room_id).await {
                tracing::info!(room_id = %room_id, "Race finished, notifying players");

                // Broadcast finish times to all players
                for (player_uuid, time_ms) in &finish_times {
                    let rank = finish_times.iter().filter(|(_, t)| *t < time_ms).count() as u8 + 1;

                    let msg = ServerMessage::RaceFinished {
                        player_uuid: *player_uuid,
                        time_ms: *time_ms,
                        rank,
                    };

                    if let Err(e) = state.connections.broadcast(room_id, &msg).await {
                        tracing::error!("Failed to broadcast finish: {}", e);
                    }
                }

                // Clean up the race
                state.race_executor.remove_race(room_id).await;
            }
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
        if let Err(e) = process_lobby_key(state, &key, &mut redis_mgr).await {
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

    let track_id: u16 = parts[1].parse().unwrap_or(1);
    let bucket = parts[2];

    // Clean up expired entries
    let removed =
        lobby::cleanup_expired_entries(redis_mgr, track_id, bucket, LOBBY_TIMEOUT_SECS + 60)
            .await?;
    if removed > 0 {
        tracing::debug!(
            track_id,
            bucket,
            removed,
            "Cleaned up expired lobby entries"
        );
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
    state
        .rooms
        .update(room_id, |r| {
            r.start_countdown(start_time_ms);
        })
        .await?;

    // Register room in Redis
    room::register_room_in_redis(redis_mgr, &room).await?;

    // Fill remaining slots with ghosts if needed
    let live_players = players.len();
    if live_players < MAX_PLAYERS_PER_ROOM {
        let ghost_count = MAX_PLAYERS_PER_ROOM - live_players;

        // Fetch ghosts to fill the room
        let ghost_backfill = GhostBackfill::new();
        match ghost_backfill
            .fetch_ghosts(track_id, bucket, ghost_count)
            .await
        {
            Ok(ghosts) => {
                let ghost_players = ghost_backfill.ghosts_to_players(ghosts);
                for ghost_player in ghost_players {
                    room.add_player(ghost_player);
                }
                tracing::info!(
                    room_id = %room_id,
                    live_players,
                    ghost_count,
                    "Added ghosts to room"
                );
            }
            Err(e) => {
                tracing::warn!("Failed to fetch ghosts: {}", e);
            }
        }
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
    #[test]
    fn test_parse_lobby_key() {
        let key = "lobby:42:elite";
        let parts: Vec<&str> = key.split(':').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[1], "42");
        assert_eq!(parts[2], "elite");
    }
}
