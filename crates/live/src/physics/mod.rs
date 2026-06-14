//! Physics simulation for live racing.
//!
//! This module provides WASM-based physics simulation for the live racing
//! pod. Per plan §Multiplayer & Backend 13:
//! - "The pod runs the same WASM physics module the client uses, at 30 Hz fixed step"
//! - "Each tick broadcasts {racer_id, x, y, angle, t} for 2–8 racers"

pub mod track;
pub mod wasm_engine;

pub use track::{TrackData, TrackStore};
pub use wasm_engine::{Obstacle, ObstacleType, PhysicsEngine, RacerPhysicsState, RacerSim};

use anyhow::{Context, Result};
use drawrace_api::blob::WheelEntry;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

/// Global physics engine singleton.
///
/// The WASM module is loaded once at startup and shared across all races.
pub struct GlobalPhysicsEngine {
    engine: Arc<PhysicsEngine>,
    track_store: Arc<TrackStore>,
}

impl GlobalPhysicsEngine {
    /// Load the physics engine and track store.
    pub fn load(tracks_dir: PathBuf) -> Result<Self> {
        let engine = PhysicsEngine::load().context("Failed to load WASM physics engine")?;

        let track_store = TrackStore::load(tracks_dir).context("Failed to load track store")?;

        tracing::info!(
            physics_version = engine.physics_version,
            track_count = track_store.track_ids().len(),
            "Loaded global physics engine"
        );

        Ok(Self {
            engine: Arc::new(engine),
            track_store: Arc::new(track_store),
        })
    }

    /// Get the physics engine.
    pub fn engine(&self) -> Arc<PhysicsEngine> {
        self.engine.clone()
    }

    /// Get the track store.
    pub fn track_store(&self) -> Arc<TrackStore> {
        self.track_store.clone()
    }

    /// Create a racer simulation for the given track and wheel.
    pub fn create_racer_sim(
        &self,
        track_id: u16,
        wheels: Vec<WheelEntry>,
        seed: u32,
    ) -> Result<RacerSim> {
        let track_data = self
            .track_store
            .get(track_id)
            .ok_or_else(|| anyhow::anyhow!("Track {} not found in track store", track_id))?;

        self.engine.create_racer_sim(
            wheels,
            &track_data.terrain,
            &track_data.obstacles,
            track_data.finish_x,
            track_data.start_x,
            track_data.start_y,
            seed,
        )
    }
}

/// Physics state for a single racer in a race.
struct LiveRacerState {
    player_uuid: Uuid,
    sim: Option<RacerSim>,
    wheel: Vec<(i16, i16)>,
    wheel_swaps: Vec<(u32, Vec<(i16, i16)>)>,
    current_tick: u32,
    finished: bool,
    finish_time_ms: u32,
}

impl LiveRacerState {
    fn new(player_uuid: Uuid, wheel: Vec<(i16, i16)>) -> Self {
        LiveRacerState {
            player_uuid,
            sim: None,
            wheel,
            wheel_swaps: Vec::new(),
            current_tick: 0,
            finished: false,
            finish_time_ms: 0,
        }
    }

    fn init_sim(&mut self, sim: RacerSim) {
        self.sim = Some(sim);
    }

    fn add_wheel_swap(&mut self, swap_tick: u32, wheel: Vec<(i16, i16)>) {
        self.wheel_swaps.push((swap_tick, wheel));
    }

    fn step(&mut self) -> Option<RacerPhysicsState> {
        if let Some(sim) = &mut self.sim {
            let state = sim.step();
            self.current_tick = sim.current_tick();
            if sim.is_finished() && !self.finished {
                self.finished = true;
                self.finish_time_ms = self.current_tick * 1000 / 60;
            }
            state
        } else {
            // Fallback placeholder (shouldn't happen if initialized properly)
            self.current_tick += 1;
            Some(RacerPhysicsState {
                x: self.current_tick as f32 * 0.1,
                y: 0.0,
                angle: (self.current_tick as f32 * 0.01).sin(),
                tick: self.current_tick,
                finished: false,
                stuck: false,
            })
        }
    }
}

/// Authoritative race simulation using WASM physics.
pub struct RaceSimulator {
    room_id: Uuid,
    racers: RwLock<Vec<LiveRacerState>>,
    track_id: u16,
    current_tick: u32,
    state: crate::messages::RoomStatus,
    physics_engine: Arc<PhysicsEngine>,
    track_store: Arc<TrackStore>,
}

impl RaceSimulator {
    /// Create a new race simulator for a room.
    pub fn new(
        room_id: Uuid,
        track_id: u16,
        physics_engine: Arc<PhysicsEngine>,
        track_store: Arc<TrackStore>,
    ) -> Self {
        RaceSimulator {
            room_id,
            racers: RwLock::new(Vec::new()),
            track_id,
            current_tick: 0,
            state: crate::messages::RoomStatus::Waiting,
            physics_engine,
            track_store,
        }
    }

    /// Add a racer to the simulation.
    pub async fn add_racer(&mut self, player_uuid: Uuid, wheel: Vec<(i16, i16)>) {
        let racer = LiveRacerState::new(player_uuid, wheel);
        self.racers.write().await.push(racer);
        metrics::gauge!("drawrace_racers_active", "room_id" => self.room_id.to_string())
            .increment(1.0);
    }

    /// Initialize all racer simulations (call before starting the race).
    pub async fn init_racer_sims(&self, seed: u32) -> Result<()> {
        let mut racers = self.racers.write().await;
        let track_data = self
            .track_store
            .get(self.track_id)
            .ok_or_else(|| anyhow::anyhow!("Track {} not found", self.track_id))?;

        for racer in racers.iter_mut() {
            // Build wheel entries array including swaps
            let mut all_wheels: Vec<WheelEntry> = Vec::new();

            // Initial wheel
            all_wheels.push(WheelEntry {
                swap_tick: 0,
                vertex_count: racer.wheel.len() as u8,
                polygon_vertices: racer.wheel.clone(),
            });

            // Swapped wheels
            for (swap_tick, wheel) in &racer.wheel_swaps {
                all_wheels.push(WheelEntry {
                    swap_tick: *swap_tick,
                    vertex_count: wheel.len() as u8,
                    polygon_vertices: wheel.clone(),
                });
            }

            let sim = self
                .physics_engine
                .create_racer_sim(
                    all_wheels,
                    &track_data.terrain,
                    &track_data.obstacles,
                    track_data.finish_x,
                    track_data.start_x,
                    track_data.start_y,
                    seed,
                )
                .with_context(|| {
                    format!(
                        "Failed to create racer sim for player {}",
                        racer.player_uuid
                    )
                })?;

            racer.init_sim(sim);
        }

        Ok(())
    }

    /// Handle a mid-race wheel swap from a client.
    pub async fn handle_wheel_swap(
        &mut self,
        player_uuid: Uuid,
        swap_tick: u32,
        wheel: Vec<(i16, i16)>,
    ) -> Result<()> {
        let mut racers = self.racers.write().await;
        let racer = racers
            .iter_mut()
            .find(|r| r.player_uuid == player_uuid)
            .context("Player not found in race")?;

        if racer.finished {
            anyhow::bail!("Player already finished, cannot swap wheel");
        }

        if swap_tick <= racer.current_tick {
            anyhow::bail!("Swap tick is in the past");
        }

        racer.add_wheel_swap(swap_tick, wheel);
        Ok(())
    }

    /// Start the countdown.
    pub async fn start_countdown(&mut self, _duration_ms: u64) {
        self.state = crate::messages::RoomStatus::CountingDown;
        metrics::counter!("drawrace_race_countdown").increment(1);
    }

    /// Start the race (after countdown).
    pub async fn start_race(&mut self) {
        self.state = crate::messages::RoomStatus::Racing;
        metrics::counter!("drawrace_race_started").increment(1);
    }

    /// Get current race state.
    pub fn state(&self) -> crate::messages::RoomStatus {
        self.state.clone()
    }

    /// Step the simulation forward by one tick (1/60 second).
    ///
    /// Returns the updated racer states for broadcasting.
    pub async fn step(&mut self) -> Vec<crate::messages::RacerState> {
        if self.state != crate::messages::RoomStatus::Racing {
            return Vec::new();
        }

        self.current_tick += 1;

        let mut racers = self.racers.write().await;
        let mut states = Vec::new();

        for racer in racers.iter_mut() {
            if racer.finished {
                // Already finished, include final state
                states.push(crate::messages::RacerState {
                    player_uuid: racer.player_uuid,
                    x: 0.0, // Will be filled by sim
                    y: 0.0,
                    angle: 0.0,
                    t_ms: racer.finish_time_ms,
                });
                continue;
            }

            // Step the simulation
            let sim_state = racer.step();

            if let Some(s) = sim_state {
                states.push(crate::messages::RacerState {
                    player_uuid: racer.player_uuid,
                    x: s.x as f64,
                    y: s.y as f64,
                    angle: s.angle,
                    t_ms: s.tick * 1000 / 60,
                });

                // Check finish line
                if s.finished {
                    metrics::counter!("drawrace_race_finished").increment(1);
                }
            }
        }

        // Check if all racers finished
        if racers.iter().all(|r| r.finished) {
            self.state = crate::messages::RoomStatus::Finished;
            metrics::counter!("drawrace_race_completed").increment(1);
        }

        states
    }

    /// Get the number of active racers.
    pub async fn racer_count(&self) -> usize {
        self.racers.read().await.len()
    }

    /// Get finish times for all racers.
    pub async fn finish_times(&self) -> std::collections::HashMap<Uuid, u32> {
        let racers = self.racers.read().await;
        racers
            .iter()
            .filter_map(|r| {
                if r.finished {
                    Some((r.player_uuid, r.finish_time_ms))
                } else {
                    None
                }
            })
            .collect()
    }

    /// Check if race is complete.
    pub fn is_finished(&self) -> bool {
        self.state == crate::messages::RoomStatus::Finished
    }
}

/// Race executor background task.
pub struct RaceExecutor {
    races: RwLock<std::collections::HashMap<Uuid, RaceSimulator>>,
    physics_engine: Arc<PhysicsEngine>,
    track_store: Arc<TrackStore>,
}

impl RaceExecutor {
    pub fn new(physics_engine: Arc<PhysicsEngine>, track_store: Arc<TrackStore>) -> Self {
        RaceExecutor {
            races: RwLock::new(std::collections::HashMap::new()),
            physics_engine,
            track_store,
        }
    }

    /// Create a new race for a room.
    pub async fn create_race(
        &self,
        room_id: Uuid,
        track_id: u16,
        players: Vec<crate::messages::PlayerInRoom>,
    ) -> Result<()> {
        let mut races = self.races.write().await;
        let mut sim = RaceSimulator::new(
            room_id,
            track_id,
            self.physics_engine.clone(),
            self.track_store.clone(),
        );

        for player in players {
            if let Some(wheel) = player.wheel {
                sim.add_racer(player.player_uuid, wheel).await;
            }
        }

        races.insert(room_id, sim);
        Ok(())
    }

    /// Initialize racer simulations for a race.
    pub async fn init_race(&self, room_id: Uuid, seed: u32) -> Result<()> {
        let mut races = self.races.write().await;
        let sim = races.get_mut(&room_id).context("Race not found")?;
        sim.init_racer_sims(seed).await
    }

    /// Start the countdown for a race.
    pub async fn start_countdown(&self, room_id: Uuid, duration_ms: u64) -> Result<()> {
        let mut races = self.races.write().await;
        let sim = races.get_mut(&room_id).context("Race not found")?;
        sim.start_countdown(duration_ms).await;
        Ok(())
    }

    /// Start a race (after countdown completes).
    pub async fn start_race(&self, room_id: Uuid) -> Result<()> {
        let mut races = self.races.write().await;
        let sim = races.get_mut(&room_id).context("Race not found")?;
        sim.start_race().await;
        Ok(())
    }

    /// Handle a wheel swap during a race.
    pub async fn handle_wheel_swap(
        &self,
        room_id: Uuid,
        player_uuid: Uuid,
        swap_tick: u32,
        wheel: Vec<(i16, i16)>,
    ) -> Result<()> {
        let mut races = self.races.write().await;
        let sim = races.get_mut(&room_id).context("Race not found")?;
        sim.handle_wheel_swap(player_uuid, swap_tick, wheel).await?;
        Ok(())
    }

    /// Step all active races and collect state updates.
    pub async fn step_all(
        &self,
    ) -> std::collections::HashMap<Uuid, Vec<crate::messages::RacerState>> {
        let mut races = self.races.write().await;
        let mut updates = std::collections::HashMap::new();

        for (room_id, sim) in races.iter_mut() {
            if sim.state() == crate::messages::RoomStatus::Racing {
                let states = sim.step().await;
                if !states.is_empty() {
                    updates.insert(*room_id, states);
                }
            }
        }

        updates
    }

    /// Get finish times for a completed race.
    pub async fn get_finish_times(
        &self,
        room_id: Uuid,
    ) -> Option<std::collections::HashMap<Uuid, u32>> {
        let races = self.races.read().await;
        let room_id_copy = room_id;
        let sim = races.get(&room_id_copy)?;
        Some(sim.finish_times().await)
    }

    /// Remove a completed race.
    pub async fn remove_race(&self, room_id: Uuid) {
        let mut races = self.races.write().await;
        races.remove(&room_id);
        metrics::gauge!("drawrace_races_active").decrement(1.0);
    }

    /// Get the count of active races.
    pub async fn race_count(&self) -> usize {
        self.races.read().await.len()
    }
}
