//! WebSocket handler for live racing
//!
//! Handles the WebSocket connection lifecycle and message routing.
//! Per plan §Multiplayer & Backend 13:
//! - "State sync rate: 20–30 Hz with client-side interpolation"
//! - "Each tick broadcasts {racer_id, x, y, angle, t} for 2–8 racers"

use anyhow::{Context, Result};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::app::LiveState;
use crate::messages::{ClientMessage, ServerMessage, RacerState, PlayerInRoom, RoomStatus};
use crate::room::{Room, RoomRegistry};

/// Active connection tracking
#[derive(Debug, Clone)]
pub struct Connection {
    pub player_uuid: Uuid,
    pub room_id: Uuid,
    pub sender: Arc<tokio::sync::Mutex<futures_util::stream::SplitSink<WebSocket, Message>>>,
}

/// Connection registry (tracks active WebSocket connections per room)
#[derive(Debug)]
pub struct ConnectionRegistry {
    connections: Arc<RwLock<Vec<Connection>>>,
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        ConnectionRegistry {
            connections: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub async fn add(&self, conn: Connection) {
        let mut conns = self.connections.write().await;
        conns.push(conn);
        metrics::gauge!("drawrace_websocket_connections").increment(1);
    }

    pub async fn remove(&self, player_uuid: Uuid) {
        let mut conns = self.connections.write().await;
        conns.retain(|c| c.player_uuid != player_uuid);
        metrics::gauge!("drawrace_websocket_connections").decrement(1.0);
    }

    pub async fn get_room_connections(&self, room_id: Uuid) -> Vec<Connection> {
        let conns = self.connections.read().await;
        conns.iter()
            .filter(|c| c.room_id == room_id)
            .cloned()
            .collect()
    }

    pub async fn count(&self) -> usize {
        self.connections.read().await.len()
    }

    pub async fn broadcast(&self, room_id: Uuid, msg: &ServerMessage) -> Result<()> {
        let msg_json = serde_json::to_string(msg)?;
        let connections = self.get_room_connections(room_id).await;

        let mut failed = Vec::new();
        for conn in &connections {
            let mut sender = conn.sender.lock().await;
            if sender.send(Message::Text(msg_json.clone())).await.is_err() {
                failed.push(conn.player_uuid);
            }
        }

        // Remove failed connections
        for player_uuid in failed {
            self.remove(player_uuid).await;
        }

        Ok(())
    }
}

impl Default for ConnectionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Handle WebSocket upgrade
pub async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<LiveState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

/// Handle a WebSocket connection
async fn handle_socket(socket: WebSocket, state: Arc<LiveState>) {
    let (sender, mut receiver) = socket.split();
    let sender = Arc::new(tokio::sync::Mutex::new(sender));

    // Track connection state
    let mut player_uuid: Option<Uuid> = None;
    let mut room_id: Option<Uuid> = None;

    while let Some(result) = receiver.next().await {
        match result {
            Ok(msg) => {
                match msg {
                    axum::extract::ws::Message::Text(text) => {
                        match serde_json::from_str::<ClientMessage>(&text) {
                            Ok(client_msg) => {
                                match handle_client_message(
                                    &state,
                                    client_msg,
                                    &mut player_uuid,
                                    &mut room_id,
                                    &sender,
                                ).await {
                                    Ok(Some(response)) => {
                                        if let Err(e) = send_message(&sender, &response).await {
                                            tracing::error!("Failed to send message: {}", e);
                                            break;
                                        }
                                    }
                                    Ok(None) => {
                                        // No response needed
                                    }
                                    Err(e) => {
                                        tracing::error!("Error handling message: {}", e);
                                        let error_msg = ServerMessage::Error {
                                            message: format!("Error: {}", e),
                                        };
                                        let _ = send_message(&sender, &error_msg).await;
                                        break;
                                    }
                                }
                            }
                            Err(e) => {
                                tracing::warn!("Invalid message format: {}", e);
                                let error_msg = ServerMessage::Error {
                                    message: "Invalid message format".to_string(),
                                };
                                let _ = send_message(&sender, &error_msg).await;
                            }
                        }
                    }
                    axum::extract::ws::Message::Close(_) => {
                        break;
                    }
                    _ => {
                        // Ignore other message types
                    }
                }
            }
            Err(e) => {
                tracing::error!("WebSocket error: {}", e);
                break;
            }
        }
    }

    // Clean up on disconnect
    if let (Some(uuid), Some(rid)) = (player_uuid, room_id) {
        handle_disconnect(&state, uuid, rid).await;
    }
}

async fn send_message(
    sender: &Arc<tokio::sync::Mutex<futures_util::stream::SplitSink<WebSocket, Message>>>,
    msg: &ServerMessage,
) -> Result<()> {
    let msg_json = serde_json::to_string(msg)?;
    let mut s = sender.lock().await;
    s.send(Message::Text(msg_json)).await?;
    Ok(())
}

async fn handle_client_message(
    state: &Arc<LiveState>,
    msg: ClientMessage,
    player_uuid: &mut Option<Uuid>,
    room_id: &mut Option<Uuid>,
    sender: &Arc<tokio::sync::Mutex<futures_util::stream::SplitSink<WebSocket, Message>>>,
) -> Result<Option<ServerMessage>> {
    match msg {
        ClientMessage::Hello { player_uuid: uuid, name, track_id } => {
            *player_uuid = Some(uuid);

            // Determine bucket (TODO: query from leaderboard API)
            let bucket = "novice";

            // Find or create room
            let rid = find_or_create_room(state, track_id, bucket, uuid, name.clone()).await?;
            *room_id = Some(rid);

            // Register connection
            state.connections.add(Connection {
                player_uuid: uuid,
                room_id: rid,
                sender: sender.clone(),
            }).await;

            // Get room state
            let room = state.rooms.get(rid).await
                .context("room not found")?;

            // Build player list
            let players = room.players.values()
                .map(|p| crate::messages::PlayerInfo {
                    player_uuid: p.player_uuid,
                    name: p.name.clone(),
                    ready: p.ready,
                })
                .collect();

            // Broadcast player joined to others
            let _ = state.connections.broadcast(rid, &ServerMessage::PlayerJoined {
                player: crate::messages::PlayerInfo {
                    player_uuid: uuid,
                    name,
                    ready: false,
                },
            }).await;

            Ok(Some(ServerMessage::Welcome {
                player_uuid: uuid,
                room_id: rid,
                players,
            }))
        }
        ClientMessage::WheelDrawing { wheel } => {
            let uuid = player_uuid.context("Not connected")?;
            let rid = room_id.context("Not in room")?;

            // Update player's wheel and mark ready
            state.rooms.update(rid, |r| {
                if let Some(p) = r.players.get_mut(&uuid) {
                    p.wheel = Some(wheel.clone());
                    p.ready = true;
                }
            }).await?;

            // Check if all players are ready
            let room = state.rooms.get(rid).await
                .ok_or_else(|| anyhow::anyhow!("room not found"))?;
            if room.is_ready() && room.player_count() >= crate::lobby::MIN_LIVE_PLAYERS {
                // Start countdown
                let start_time_ms = crate::lobby::now_ms() + 3000; // 3 seconds
                state.rooms.update(rid, |r| {
                    r.start_countdown(start_time_ms);
                }).await?;

                // Broadcast countdown
                state.connections.broadcast(rid, &ServerMessage::RaceStart {
                    countdown: 3,
                    start_time_ms,
                }).await?;
            }

            Ok(None)
        }
        ClientMessage::WheelSwap { swap_tick, wheel } => {
            // TODO: Implement wheel swap logic
            Ok(None)
        }
        ClientMessage::Ping { timestamp } => {
            Ok(Some(ServerMessage::Pong { timestamp }))
        }
    }
}

async fn handle_disconnect(state: &Arc<LiveState>, player_uuid: Uuid, room_id: Uuid) {
    // Remove from connection registry
    state.connections.remove(player_uuid).await;

    // Remove from room
    state.rooms.update(room_id, |r| {
        r.remove_player(player_uuid);
    }).await.ok();

    // Broadcast player left
    let _ = state.connections.broadcast(room_id, &ServerMessage::PlayerLeft {
        player_uuid,
    }).await;

    // If room is empty, clean it up
    let room = state.rooms.get(room_id).await;
    if let Some(room) = room {
        if room.player_count() == 0 {
            state.rooms.remove(room_id).await;
            let mut redis_mgr = state.redis_mgr.lock().await;
            let _ = crate::room::unregister_room_from_redis(&mut redis_mgr, room_id).await;
        }
    }
}

/// Handle ClientMessage::Hello
async fn handle_hello(
    state: &Arc<LiveState>,
    player_uuid: Uuid,
    name: String,
    track_id: u16,
) -> Result<ServerMessage> {
    // Determine player's bucket based on PB (query from main API)
    // For now, default to "novice"
    let bucket = "novice"; // TODO: Query from leaderboard

    // Try to find an existing waiting room, or create a new one
    let room_id = find_or_create_room(state, track_id, bucket, player_uuid, name.clone()).await?;

    // Get room state
    let room = state.rooms.get(room_id).await
        .context("room not found")?;

    // Build player list for Welcome message
    let players = room.players.values()
        .map(|p| crate::messages::PlayerInfo {
            player_uuid: p.player_uuid,
            name: p.name.clone(),
            ready: p.ready,
        })
        .collect();

    Ok(ServerMessage::Welcome {
        player_uuid,
        room_id,
        players,
    })
}

/// Find an existing waiting room or create a new one
async fn find_or_create_room(
    state: &Arc<LiveState>,
    track_id: u16,
    _bucket: &str,
    player_uuid: Uuid,
    name: String,
) -> Result<Uuid> {
    let mut redis_mgr = state.redis_mgr.lock().await;

    // First, try to find an existing room with space
    // For simplicity, we'll always create a new room for now
    // In production, you'd scan Redis for rooms in Waiting status

    let room_id = Uuid::new_v4();
    let pod_ip = state.pod_ip.clone();

    // Create the room in memory
    let mut room = state.rooms.create(room_id, track_id, pod_ip).await;

    // Add the player
    room.add_player(PlayerInRoom {
        player_uuid,
        name: name.clone(),
        ready: false,
        wheel: None,
    });

    // Update in registry
    state.rooms.update(room_id, |r| {
        r.add_player(PlayerInRoom {
            player_uuid,
            name,
            ready: false,
            wheel: None,
        });
    }).await?;

    // Register in Redis
    crate::room::register_room_in_redis(&mut *redis_mgr, &room).await?;

    Ok(room_id)
}

/// Broadcast state to all players in a room
pub async fn broadcast_state(
    _state: &Arc<LiveState>,
    room_id: Uuid,
    tick: u32,
    racers: Vec<RacerState>,
) -> Result<()> {
    let msg = ServerMessage::State { tick, racers: racers.clone() };
    let _msg_json = serde_json::to_string(&msg)?;

    // TODO: Send to all connected players in the room
    // For now, we'd need to track active connections per room

    tracing::debug!(room_id = %room_id, tick, "Broadcasting state to {} racers", racers.len());

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_serialization() {
        let msg = ServerMessage::Welcome {
            player_uuid: Uuid::nil(),
            room_id: Uuid::new_v4(),
            players: vec![],
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"welcome""#));
    }
}
