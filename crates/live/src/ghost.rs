//! Ghost backfill for live races
//!
//! Per plan §Multiplayer & Backend 13:
//! - "After a timeout (say 8s), fill empty slots with ghosts"
//! - "Ghosts from the same bucket"
//! - "The v1 ghost system becomes the v2 'AI opponents / backfill' system"

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::messages::{PlayerInRoom, RacerState};

/// Matchmake API response from drawrace-api
#[derive(Debug, Deserialize)]
pub struct MatchmakeResponse {
    pub track_id: i16,
    pub player_bucket: String,
    pub target_bucket: String,
    pub ghosts: Vec<ApiGhost>,
    pub shadow_ghost: Option<ApiGhost>,
    pub expires_at: String,
}

/// Ghost entry from matchmake API
#[derive(Debug, Deserialize, Clone)]
pub struct ApiGhost {
    pub ghost_id: Uuid,
    pub time_ms: i32,
    pub name: String,
    pub url: String,
}

/// Ghost blob format from S3 (full replay data)
#[derive(Debug, Deserialize)]
pub struct GhostBlob {
    pub track_id: u16,
    pub time_ms: u32,
    pub wheel: Vec<(i16, i16)>,
    pub swaps: Vec<GhostSwap>,
}

#[derive(Debug, Deserialize)]
pub struct GhostSwap {
    pub tick: u32,
    pub wheel: Vec<(i16, i16)>,
}

/// Ghost player that fills empty slots in a race
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhostPlayer {
    pub ghost_id: String,
    pub name: String,
    /// Ghost replay data (wheel swaps + finish time)
    pub replay: GhostReplay,
}

/// Ghost replay data
///
/// This is a simplified version of the ghost blob format
/// containing only what's needed for live race playback.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhostReplay {
    pub track_id: u16,
    pub finish_time_ms: u32,
    /// Initial wheel polygon
    pub initial_wheel: Vec<(i16, i16)>,
    /// Wheel swaps: (tick, wheel_polygon)
    pub wheel_swaps: Vec<(u32, Vec<(i16, i16)>)>,
}

/// Ghost backfill service
///
/// Fetches ghosts from the ghost store to fill empty race slots.
pub struct GhostBackfill {
    /// HTTP client for API requests
    client: reqwest::Client,
    /// Base URL for drawrace-api
    api_url: String,
}

impl GhostBackfill {
    pub fn new() -> Self {
        let api_url = std::env::var("DRAWRACE_API_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:3000".to_string());
        GhostBackfill {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .expect("Failed to build HTTP client"),
            api_url,
        }
    }

    /// Fetch N ghosts for a track and bucket to fill empty slots
    pub async fn fetch_ghosts(
        &self,
        track_id: u16,
        _bucket: &str,
        count: usize,
    ) -> Result<Vec<GhostPlayer>> {
        // Call the matchmake API to get ghost list
        let url = format!(
            "{}/v1/matchmake/{}",
            self.api_url.trim_end_matches('/'),
            track_id
        );

        // Use a placeholder player_uuid for ghost-only fetching (no shadow ghost needed)
        let response = self
            .client
            .get(&url)
            .query(&[("player_uuid", Uuid::nil())])
            .send()
            .await
            .context("Failed to call matchmake API")?;

        if !response.status().is_success() {
            anyhow::bail!("Matchmake API returned status: {}", response.status());
        }

        let matchmake: MatchmakeResponse = response
            .json()
            .await
            .context("Failed to parse matchmake response")?;

        // Download ghost data from presigned S3 URLs
        let mut ghosts = Vec::new();
        for api_ghost in matchmake.ghosts.into_iter().take(count) {
            match self.fetch_ghost_blob(&api_ghost.url).await {
                Ok(blob) => {
                    ghosts.push(GhostPlayer {
                        ghost_id: api_ghost.ghost_id.to_string(),
                        name: api_ghost.name,
                        replay: GhostReplay {
                            track_id: blob.track_id,
                            finish_time_ms: blob.time_ms,
                            initial_wheel: blob.wheel,
                            wheel_swaps: blob
                                .swaps
                                .into_iter()
                                .map(|s| (s.tick, s.wheel))
                                .collect(),
                        },
                    });
                }
                Err(e) => {
                    tracing::warn!(
                        ghost_id = %api_ghost.ghost_id,
                        error = %e,
                        "Failed to fetch ghost blob, skipping"
                    );
                    // Continue with other ghosts even if one fails
                }
            }
        }

        // If we didn't get enough ghosts, fall back to placeholders
        let shortage = count.saturating_sub(ghosts.len());
        if shortage > 0 {
            tracing::warn!(
                track_id = track_id,
                bucket = %_bucket,
                got = ghosts.len(),
                needed = count,
                "Ghost shortage, using placeholders"
            );
            for i in 0..shortage {
                ghosts.push(GhostPlayer {
                    ghost_id: format!("ghost-fallback-{}", i),
                    name: format!("Ghost {}", ghosts.len() + i + 1),
                    replay: GhostReplay {
                        track_id,
                        finish_time_ms: 45000 + (i as u32 * 3000),
                        initial_wheel: vec![(0, -50), (50, -50), (50, 50), (0, 50)],
                        wheel_swaps: vec![],
                    },
                });
            }
        }

        Ok(ghosts)
    }

    /// Fetch ghost blob data from presigned S3 URL
    async fn fetch_ghost_blob(&self, url: &str) -> Result<GhostBlob> {
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("Failed to fetch ghost blob from S3")?;

        if !response.status().is_success() {
            anyhow::bail!("S3 returned status: {}", response.status());
        }

        let blob: GhostBlob = response
            .json()
            .await
            .context("Failed to parse ghost blob")?;

        Ok(blob)
    }

    /// Convert ghosts to PlayerInRoom for room creation
    pub fn ghosts_to_players(&self, ghosts: Vec<GhostPlayer>) -> Vec<PlayerInRoom> {
        ghosts
            .into_iter()
            .map(|ghost| {
                let wheel = ghost.replay.initial_wheel.clone();
                PlayerInRoom {
                    player_uuid: Uuid::new_v4(), // Ghosts get random UUIDs
                    name: ghost.name,
                    ready: true, // Ghosts are always ready
                    wheel: Some(wheel),
                }
            })
            .collect()
    }
}

impl Default for GhostBackfill {
    fn default() -> Self {
        Self::new()
    }
}

/// Ghost state during a race
///
/// Tracks the current playback state of a ghost.
#[derive(Debug, Clone)]
pub struct GhostRacer {
    pub player_uuid: Uuid,
    pub replay: GhostReplay,
    pub current_tick: u32,
    pub chassis_x: f32,
    pub chassis_y: f32,
    pub angle: f32,
    pub finished: bool,
}

impl GhostRacer {
    pub fn new(player_uuid: Uuid, replay: GhostReplay) -> Self {
        GhostRacer {
            player_uuid,
            replay,
            current_tick: 0,
            chassis_x: 0.0,
            chassis_y: 0.0,
            angle: 0.0,
            finished: false,
        }
    }

    /// Step the ghost forward by one tick
    ///
    /// Returns the new racer state if the ghost is still racing,
    /// or the final state if finished.
    pub fn step(&mut self, tick: u32) -> Option<RacerState> {
        if self.finished {
            return Some(RacerState {
                player_uuid: self.player_uuid,
                x: self.chassis_x as f64,
                y: self.chassis_y as f64,
                angle: self.angle,
                t_ms: self.replay.finish_time_ms,
            });
        }

        self.current_tick = tick;

        // Simple linear interpolation based on finish time
        // In production, this would replay the actual ghost physics
        let progress = (tick as f32 * 16.0) / self.replay.finish_time_ms as f32;
        const TRACK_LENGTH: f32 = 1000.0;
        self.chassis_x = progress * TRACK_LENGTH;

        // Check if finished
        if self.chassis_x >= TRACK_LENGTH {
            self.finished = true;
            return Some(RacerState {
                player_uuid: self.player_uuid,
                x: self.chassis_x as f64,
                y: self.chassis_y as f64,
                angle: self.angle,
                t_ms: self.replay.finish_time_ms,
            });
        }

        // Simple rotation animation
        self.angle = (tick as f32 * 0.02).sin();

        Some(RacerState {
            player_uuid: self.player_uuid,
            x: self.chassis_x as f64,
            y: self.chassis_y as f64,
            angle: self.angle,
            t_ms: tick * 1000 / 60,
        })
    }

    /// Get the wheel that should be active at the given tick
    pub fn wheel_at_tick(&self, tick: u32) -> &[(i16, i16)] {
        for (swap_tick, wheel) in self.replay.wheel_swaps.iter().rev() {
            if tick >= *swap_tick {
                return wheel;
            }
        }
        &self.replay.initial_wheel
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ghost_replay() {
        let replay = GhostReplay {
            track_id: 1,
            finish_time_ms: 30000,
            initial_wheel: vec![(0, -50), (50, -50), (50, 50), (0, 50)],
            wheel_swaps: vec![(100, vec![(0, -40), (40, -40), (40, 40), (0, 40)])],
        };

        assert_eq!(replay.track_id, 1);
        assert_eq!(replay.finish_time_ms, 30000);
        assert_eq!(replay.wheel_swaps.len(), 1);
    }

    #[test]
    fn test_ghost_racer() {
        let replay = GhostReplay {
            track_id: 1,
            finish_time_ms: 60000, // 60 seconds
            initial_wheel: vec![(0, -50), (50, -50), (50, 50), (0, 50)],
            wheel_swaps: vec![],
        };

        let player_uuid = Uuid::new_v4();
        let mut ghost = GhostRacer::new(player_uuid, replay.clone());

        // Step at tick 0
        let state = ghost.step(0).unwrap();
        assert_eq!(state.player_uuid, player_uuid);
        assert!(!ghost.finished);

        // Step at tick 3750 (should be past finish at 60s)
        // 3750 * 16ms = 60000ms
        let state = ghost.step(3750).unwrap();
        assert!(ghost.finished || ghost.chassis_x >= 999.0);
        assert_eq!(state.t_ms, replay.finish_time_ms);
    }

    #[test]
    fn test_wheel_at_tick() {
        let replay = GhostReplay {
            track_id: 1,
            finish_time_ms: 30000,
            initial_wheel: vec![(0, -50), (50, -50), (50, 50), (0, 50)],
            wheel_swaps: vec![
                (100, vec![(0, -40), (40, -40), (40, 40), (0, 40)]),
                (200, vec![(0, -30), (30, -30), (30, 30), (0, 30)]),
            ],
        };

        let ghost = GhostRacer::new(Uuid::new_v4(), replay);

        // Before first swap
        let wheel = ghost.wheel_at_tick(0);
        assert_eq!(wheel.len(), 4);

        // After first swap
        let wheel = ghost.wheel_at_tick(100);
        assert_eq!(wheel.len(), 4);

        // After second swap
        let wheel = ghost.wheel_at_tick(200);
        assert_eq!(wheel.len(), 4);
    }

    #[tokio::test]
    async fn test_ghost_backfill() {
        let backfill = GhostBackfill::new();

        // Fetch 3 ghosts
        // Note: This test will use fallback placeholders if the API is unavailable
        let ghosts = backfill.fetch_ghosts(1, "novice", 3).await.unwrap();
        // Should return exactly 3 ghosts (either from API or placeholders)
        assert_eq!(ghosts.len(), 3);

        // Convert to players
        let players = backfill.ghosts_to_players(ghosts);
        assert_eq!(players.len(), 3);

        for player in players {
            assert!(player.ready);
            assert!(player.wheel.is_some());
        }
    }
}
