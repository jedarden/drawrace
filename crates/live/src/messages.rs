//! WebSocket protocol messages for live racing
//!
//! The protocol follows the plan §Multiplayer & Backend 13:
//! - State sync at 20-30 Hz with client-side interpolation
//! - ~200 bytes per racer per tick
//! - 2-8 racers per room

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Client -> Server messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum ClientMessage {
    /// Initial handshake with player identity
    Hello {
        player_uuid: Uuid,
        name: String,
        track_id: u16,
    },
    /// Submit initial wheel drawing (before race start)
    WheelDrawing {
        /// Serialized wheel polygon (same format as ghost blob wheels[])
        wheel: Vec<(i16, i16)>,
    },
    /// Mid-race wheel swap (same mechanics as ghost replay)
    WheelSwap {
        /// Swap tick (when this wheel should be applied)
        swap_tick: u32,
        /// New wheel polygon
        wheel: Vec<(i16, i16)>,
    },
    /// Ping for latency measurement
    Ping { timestamp: u64 },
}

/// Server -> Client messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum ServerMessage {
    /// Handshake response
    Welcome {
        player_uuid: Uuid,
        room_id: Uuid,
        /// Other players in the room (may be empty if waiting)
        players: Vec<PlayerInfo>,
    },
    /// Race is starting (countdown)
    RaceStart {
        /// Countdown in seconds (3, 2, 1, 0 = GO)
        countdown: u8,
        /// When countdown ends (unix timestamp ms)
        start_time_ms: i64,
    },
    /// Authoritative state snapshot (broadcast at 20-30 Hz)
    State { tick: u32, racers: Vec<RacerState> },
    /// Player joined the lobby/room
    PlayerJoined { player: PlayerInfo },
    /// Player disconnected
    PlayerLeft { player_uuid: Uuid },
    /// Race finished
    RaceFinished {
        player_uuid: Uuid,
        time_ms: u32,
        rank: u8,
    },
    /// Pong response
    Pong { timestamp: u64 },
    /// Error condition
    Error { message: String },
}

/// Player information for lobby display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerInfo {
    pub player_uuid: Uuid,
    pub name: String,
    /// Ready to race (has submitted wheel drawing)
    pub ready: bool,
}

/// Racer state snapshot (per tick, per racer)
///
/// ~200 bytes per racer: 16 (uuid) + 8 (x) + 8 (y) + 4 (angle) + 8 (t) + overhead
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RacerState {
    pub player_uuid: Uuid,
    /// X position in meters
    pub x: f64,
    /// Y position in meters
    pub y: f64,
    /// Heading angle in radians
    pub angle: f32,
    /// Race time in milliseconds
    pub t_ms: u32,
}

/// Room state in Redis (for lobby management)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomState {
    pub room_id: Uuid,
    pub track_id: u16,
    pub players: Vec<PlayerInRoom>,
    pub status: RoomStatus,
    /// Which pod owns this room (for sticky routing)
    pub pod_ip: String,
    /// Last update timestamp
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerInRoom {
    pub player_uuid: Uuid,
    pub name: String,
    pub ready: bool,
    pub wheel: Option<Vec<(i16, i16)>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RoomStatus {
    Waiting,
    CountingDown,
    Racing,
    Finished,
}

/// Lobby pool state in Redis
///
/// One ZSET per track per bucket: `lobby:{track_id}:{bucket}`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LobbyPlayer {
    pub player_uuid: Uuid,
    pub name: String,
    pub joined_at: i64,
}

impl ClientMessage {
    pub fn message_type(&self) -> &'static str {
        match self {
            ClientMessage::Hello { .. } => "hello",
            ClientMessage::WheelDrawing { .. } => "wheel_drawing",
            ClientMessage::WheelSwap { .. } => "wheel_swap",
            ClientMessage::Ping { .. } => "ping",
        }
    }
}

impl ServerMessage {
    pub fn message_type(&self) -> &'static str {
        match self {
            ServerMessage::Welcome { .. } => "welcome",
            ServerMessage::RaceStart { .. } => "race_start",
            ServerMessage::State { .. } => "state",
            ServerMessage::PlayerJoined { .. } => "player_joined",
            ServerMessage::PlayerLeft { .. } => "player_left",
            ServerMessage::RaceFinished { .. } => "race_finished",
            ServerMessage::Pong { .. } => "pong",
            ServerMessage::Error { .. } => "error",
        }
    }
}
