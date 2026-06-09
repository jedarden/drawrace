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
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::app::LiveState;
use crate::messages::{ClientMessage, ServerMessage, PlayerInRoom};

/// Matchmake API response for bucket lookup
#[derive(Deserialize)]
struct BucketLookupResponse {
    pub player_bucket: String,
}

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

/// Query the matchmake API for the player's bucket
async fn get_player_bucket(player_uuid: Uuid, track_id: u16) -> String {
    let api_url = std::env::var("DRAWRACE_API_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:3000".to_string());

    let url = format!(
        "{}/v1/matchmake/{}",
        api_url.trim_end_matches('/'),
        track_id
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build();

    let client = match client {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "Failed to build HTTP client, using default bucket");
            return "novice".to_string();
        }
    };

    match client
        .get(&url)
        .query(&[("player_uuid", player_uuid)])
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {
            match response.json::<BucketLookupResponse>().await {
                Ok(bucket_resp) => {
                    tracing::debug!(
                        player_uuid = %player_uuid,
                        bucket = %bucket_resp.player_bucket,
                        "Resolved player bucket"
                    );
                    bucket_resp.player_bucket
                }
                Err(e) => {
                    tracing::warn!(error = %e, "Failed to parse bucket response, using default");
                    "novice".to_string()
                }
            }
        }
        Ok(response) => {
            tracing::warn!(status = %response.status(), "Matchmake API error, using default bucket");
            "novice".to_string()
        }
        Err(e) => {
            tracing::warn!(error = %e, "Matchmake API unavailable, using default bucket");
            "novice".to_string()
        }
    }
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

            // Determine bucket from leaderboard API
            let bucket = get_player_bucket(uuid, track_id).await;

            // Find or create room
            let rid = find_or_create_room(state, track_id, &bucket, uuid, name.clone()).await?;
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
                // Create the race in the executor
                let players: Vec<_> = room.players.values().cloned().collect();
                if let Err(e) = state.race_executor.create_race(rid, room.track_id, players).await {
                    tracing::error!("Failed to create race: {}", e);
                }

                // Start countdown (3 seconds)
                let start_time_ms = crate::lobby::now_ms() + 3000;
                state.rooms.update(rid, |r| {
                    r.start_countdown(start_time_ms);
                }).await?;

                if let Err(e) = state.race_executor.start_countdown(rid, 3000).await {
                    tracing::error!("Failed to start countdown: {}", e);
                }

                // Broadcast countdown
                state.connections.broadcast(rid, &ServerMessage::RaceStart {
                    countdown: 3,
                    start_time_ms,
                }).await?;

                // Start the race after countdown
                let rid_clone = rid;
                let state_clone = state.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(tokio::time::Duration::from_millis(3000)).await;
                    if let Err(e) = state_clone.race_executor.start_race(rid_clone).await {
                        tracing::error!("Failed to start race: {}", e);
                    }
                });
            }

            Ok(None)
        }
        ClientMessage::WheelSwap { swap_tick, wheel } => {
            let uuid = player_uuid.context("Not connected")?;
            let rid = room_id.context("Not in room")?;

            // Forward to race executor for handling
            state.race_executor.handle_wheel_swap(rid, uuid, swap_tick, wheel).await?;

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
    crate::room::register_room_in_redis(&mut redis_mgr, &room).await?;

    Ok(room_id)
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
        // The tag serialization uses the variant name "Welcome"
        assert!(json.contains("\"type\":\"Welcome\""));
    }
}
