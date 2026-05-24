//! Room management for live races
//!
//! Per plan §Multiplayer & Backend 13:
//! - "Sticky sessions via rooms, not LB"
//! - "Each race is a room keyed by race_id"
//! - "Lightweight router (Redis HSET race:{id} pod {pod_ip}) pins a room to one pod"

use anyhow::{Context, Result};
use redis::AsyncCommands;
use serde::{Serialize, Deserialize};
use uuid::Uuid;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::messages::{PlayerInRoom, RoomStatus};

/// Room TTL in Redis (auto-cleanup after race finishes + disconnect grace period)
pub const ROOM_TTL: usize = 600; // 10 minutes

/// In-memory room state (lives on the pod that owns the room)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Room {
    pub room_id: Uuid,
    pub track_id: u16,
    pub players: HashMap<Uuid, PlayerInRoom>,
    pub status: RoomStatus,
    pub pod_ip: String,
    /// Current tick (for authoritative sim)
    pub tick: u32,
    /// Start time (unix timestamp ms)
    pub start_time_ms: Option<i64>,
    /// Race finish times (player_uuid -> time_ms)
    pub finish_times: HashMap<Uuid, u32>,
}

impl Room {
    pub fn new(room_id: Uuid, track_id: u16, pod_ip: String) -> Self {
        Room {
            room_id,
            track_id,
            players: HashMap::new(),
            status: RoomStatus::Waiting,
            pod_ip,
            tick: 0,
            start_time_ms: None,
            finish_times: HashMap::new(),
        }
    }

    pub fn add_player(&mut self, player: PlayerInRoom) {
        self.players.insert(player.player_uuid, player);
    }

    pub fn remove_player(&mut self, player_uuid: Uuid) {
        self.players.remove(&player_uuid);
    }

    pub fn player_count(&self) -> usize {
        self.players.len()
    }

    pub fn is_ready(&self) -> bool {
        self.players.values().all(|p| p.ready)
    }

    pub fn all_finished(&self) -> bool {
        if self.status != RoomStatus::Racing {
            return false;
        }
        !self.players.is_empty() && self.players.len() == self.finish_times.len()
    }

    pub fn start_countdown(&mut self, start_time_ms: i64) {
        self.status = RoomStatus::CountingDown;
        self.start_time_ms = Some(start_time_ms);
    }

    pub fn start_race(&mut self) {
        self.status = RoomStatus::Racing;
    }

    pub fn finish(&mut self) {
        self.status = RoomStatus::Finished;
    }

    pub fn record_finish(&mut self, player_uuid: Uuid, time_ms: u32) {
        self.finish_times.insert(player_uuid, time_ms);
    }
}

/// Room registry (in-memory, pod-local)
#[derive(Debug, Clone)]
pub struct RoomRegistry {
    rooms: Arc<RwLock<HashMap<Uuid, Room>>>,
}

impl RoomRegistry {
    pub fn new() -> Self {
        RoomRegistry {
            rooms: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn create(&self, room_id: Uuid, track_id: u16, pod_ip: String) -> Room {
        let room = Room::new(room_id, track_id, pod_ip);
        self.rooms.write().await.insert(room_id, room.clone());
        metrics::gauge!("drawrace_rooms_active").increment(1.0);
        room
    }

    pub async fn get(&self, room_id: Uuid) -> Option<Room> {
        self.rooms.read().await.get(&room_id).cloned()
    }

    pub async fn update<F>(&self, room_id: Uuid, f: F) -> Result<()>
    where
        F: FnOnce(&mut Room),
    {
        let mut rooms = self.rooms.write().await;
        let room = rooms.get_mut(&room_id)
            .context("room not found")?;
        f(room);
        Ok(())
    }

    pub async fn remove(&self, room_id: Uuid) -> Option<Room> {
        let room = self.rooms.write().await.remove(&room_id);
        if room.is_some() {
            metrics::gauge!("drawrace_rooms_active").decrement(1.0);
        }
        room
    }

    pub async fn count(&self) -> usize {
        self.rooms.read().await.len()
    }
}

impl Default for RoomRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Register room in Redis (for routing and discovery)
pub async fn register_room_in_redis(
    redis: &mut redis::aio::ConnectionManager,
    room: &Room,
) -> Result<()> {
    let key = room_key(room.room_id);
    let value = serde_json::to_string(room)?;

    redis::cmd("HSET")
        .arg(&key)
        .arg("state")
        .arg(&value)
        .arg("pod")
        .arg(&room.pod_ip)
        .arg("updated_at")
        .arg(crate::lobby::now_ms())
        .query_async::<_, ()>(redis)
        .await?;

    // Set TTL
    redis::cmd("EXPIRE")
        .arg(&key)
        .arg(ROOM_TTL)
        .query_async::<_, ()>(redis)
        .await?;

    Ok(())
}

/// Update room state in Redis
pub async fn update_room_in_redis(
    redis: &mut redis::aio::ConnectionManager,
    room: &Room,
) -> Result<()> {
    let key = room_key(room.room_id);
    let value = serde_json::to_string(room)?;

    redis::cmd("HSET")
        .arg(&key)
        .arg("state")
        .arg(&value)
        .arg("updated_at")
        .arg(crate::lobby::now_ms())
        .query_async::<_, ()>(redis)
        .await?;

    // Refresh TTL
    redis::cmd("EXPIRE")
        .arg(&key)
        .arg(ROOM_TTL)
        .query_async::<_, ()>(redis)
        .await?;

    Ok(())
}

/// Remove room from Redis
pub async fn unregister_room_from_redis(
    redis: &mut redis::aio::ConnectionManager,
    room_id: Uuid,
) -> Result<()> {
    let key = room_key(room_id);
    redis::cmd("DEL")
        .arg(&key)
        .query_async::<_, ()>(redis)
        .await?;
    Ok(())
}

/// Get room's pod IP (for routing)
pub async fn get_room_pod(
    redis: &mut redis::aio::ConnectionManager,
    room_id: Uuid,
) -> Result<Option<String>> {
    let key = room_key(room_id);
    let pod: Option<String> = redis::cmd("HGET")
        .arg(&key)
        .arg("pod")
        .query_async::<_, Option<String>>(redis)
        .await?;
    Ok(pod)
}

fn room_key(room_id: Uuid) -> String {
    format!("race:{}", room_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_room_key() {
        let room_id = Uuid::nil();
        assert_eq!(room_key(room_id), "race:00000000-0000-0000-0000-000000000000");
    }

    #[test]
    fn test_room_lifecycle() {
        let room_id = Uuid::new_v4();
        let mut room = Room::new(room_id, 1, "10.0.0.1".to_string());

        assert_eq!(room.player_count(), 0);
        assert!(!room.is_ready());

        room.add_player(PlayerInRoom {
            player_uuid: Uuid::new_v4(),
            name: "Alice".to_string(),
            ready: true,
            wheel: Some(vec![(0, 0), (10, 0), (10, 10), (0, 10)]),
        });

        assert_eq!(room.player_count(), 1);
        assert!(room.is_ready());
    }
}
