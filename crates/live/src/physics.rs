//! Authoritative physics simulation for live racing
//!
//! This module loads the engine-core WASM module and runs deterministic
//! simulation for all racers in a room. Per plan §Multiplayer & Backend 13:
//! - "The pod runs the same WASM physics module the client uses, at 30 Hz fixed step"
//! - "Each tick broadcasts {racer_id, x, y, angle, t} for 2–8 racers"

use anyhow::{Context, Result};
use std::collections::HashMap;
use std::time::Instant;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::messages::{PlayerInRoom, RacerState};

/// Physics simulation state for a single racer
#[derive(Debug, Clone)]
struct RacerSim {
    player_uuid: Uuid,
    wheel: Vec<(i16, i16)>,
    wheel_swaps: Vec<(u32, Vec<(i16, i16)>)>, // (swap_tick, wheel)
    current_tick: u32,
    finished: bool,
    finish_time_ms: u32,
    chassis_x: f32,
    chassis_y: f32,
    angle: f32,
}

impl RacerSim {
    fn new(player_uuid: Uuid, wheel: Vec<(i16, i16)>) -> Self {
        RacerSim {
            player_uuid,
            wheel,
            wheel_swaps: Vec::new(),
            current_tick: 0,
            finished: false,
            finish_time_ms: 0,
            chassis_x: 0.0,
            chassis_y: 0.0,
            angle: 0.0,
        }
    }

    fn add_wheel_swap(&mut self, swap_tick: u32, wheel: Vec<(i16, i16)>) {
        self.wheel_swaps.push((swap_tick, wheel));
    }

    /// Get the wheel that should be active at the given tick
    fn wheel_at_tick(&self, tick: u32) -> &[(i16, i16)] {
        for (swap_tick, wheel) in self.wheel_swaps.iter().rev() {
            if tick >= *swap_tick {
                return wheel;
            }
        }
        &self.wheel
    }
}

/// Authoritative race simulation
///
/// Runs all racers in a room at 30 Hz fixed timestep, broadcasting
/// state updates to connected clients.
pub struct RaceSimulator {
    room_id: Uuid,
    racers: HashMap<Uuid, RacerSim>,
    track_id: u16,
    current_tick: u32,
    start_time: Option<Instant>,
    state: RaceState,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RaceState {
    Waiting,
    CountingDown,
    Racing,
    Finished,
}

impl RaceSimulator {
    /// Create a new race simulator for a room
    pub fn new(room_id: Uuid, track_id: u16) -> Self {
        RaceSimulator {
            room_id,
            racers: HashMap::new(),
            track_id,
            current_tick: 0,
            start_time: None,
            state: RaceState::Waiting,
        }
    }

    /// Add a racer to the simulation
    pub fn add_racer(&mut self, player_uuid: Uuid, wheel: Vec<(i16, i16)>) {
        let racer = RacerSim::new(player_uuid, wheel);
        self.racers.insert(player_uuid, racer);
        metrics::gauge!("drawrace_racers_active", "room_id" => self.room_id.to_string())
            .increment(1.0);
    }

    /// Handle a mid-race wheel swap from a client
    pub fn handle_wheel_swap(&mut self, player_uuid: Uuid, swap_tick: u32, wheel: Vec<(i16, i16)>) -> Result<()> {
        let racer = self.racers.get_mut(&player_uuid)
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

    /// Start the countdown
    pub fn start_countdown(&mut self, duration_ms: u64) {
        self.state = RaceState::CountingDown;
        self.start_time = Some(Instant::now());
        metrics::counter!("drawrace_race_countdown").increment(1);
    }

    /// Start the race (after countdown)
    pub fn start_race(&mut self) {
        self.state = RaceState::Racing;
        self.start_time = Some(Instant::now());
        metrics::counter!("drawrace_race_started").increment(1);
    }

    /// Get current race state
    pub fn state(&self) -> RaceState {
        self.state
    }

    /// Step the simulation forward by one tick (1/60 second)
    ///
    /// Returns the updated racer states for broadcasting.
    pub fn step(&mut self) -> Vec<RacerState> {
        if self.state != RaceState::Racing {
            return Vec::new();
        }

        self.current_tick += 1;
        let tick = self.current_tick;

        // Step each racer's simulation
        let mut states = Vec::new();
        for (player_uuid, racer) in self.racers.iter_mut() {
            if racer.finished {
                // Already finished, include final state
                states.push(RacerState {
                    player_uuid: *player_uuid,
                    x: racer.chassis_x as f64,
                    y: racer.chassis_y as f64,
                    angle: racer.angle,
                    t_ms: racer.finish_time_ms,
                });
                continue;
            }

            // Check for wheel swap at this tick
            let _current_wheel = racer.wheel_at_tick(tick);
            racer.current_tick = tick;

            // TODO: Run actual WASM physics step here
            // For now, we simulate a simple forward motion
            // This is a placeholder until we integrate the WASM module
            let progress_per_tick = 0.1; // meters per tick at ~6 m/s
            racer.chassis_x += progress_per_tick;

            // Simple finish detection (at 1000m track length)
            const FINISH_X: f32 = 1000.0;
            if racer.chassis_x >= FINISH_X {
                racer.finished = true;
                racer.finish_time_ms = (tick * 1000 / 60) as u32; // approx ms at 60Hz
                metrics::counter!("drawrace_race_finished").increment(1);
            }

            // Calculate angle from wheel shape (simple heuristic for now)
            racer.angle = (tick as f32 * 0.01).sin();

            states.push(RacerState {
                player_uuid: *player_uuid,
                x: racer.chassis_x as f64,
                y: racer.chassis_y as f64,
                angle: racer.angle,
                t_ms: (tick * 1000 / 60) as u32,
            });
        }

        // Check if all racers finished
        if self.racers.values().all(|r| r.finished) {
            self.state = RaceState::Finished;
            metrics::counter!("drawrace_race_completed").increment(1);
        }

        states
    }

    /// Get the number of active racers
    pub fn racer_count(&self) -> usize {
        self.racers.len()
    }

    /// Get finish times for all racers
    pub fn finish_times(&self) -> HashMap<Uuid, u32> {
        self.racers.iter()
            .filter_map(|(uuid, racer)| {
                if racer.finished {
                    Some((*uuid, racer.finish_time_ms))
                } else {
                    None
                }
            })
            .collect()
    }

    /// Check if race is complete
    pub fn is_finished(&self) -> bool {
        self.state == RaceState::Finished
    }
}

/// Race executor background task
///
/// Manages active races and runs their simulation loops.
pub struct RaceExecutor {
    races: RwLock<HashMap<Uuid, RaceSimulator>>,
}

impl RaceExecutor {
    pub fn new() -> Self {
        RaceExecutor {
            races: RwLock::new(HashMap::new()),
        }
    }

    /// Create a new race for a room
    pub async fn create_race(&self, room_id: Uuid, track_id: u16, players: Vec<PlayerInRoom>) -> Result<()> {
        let mut races = self.races.write().await;
        let mut sim = RaceSimulator::new(room_id, track_id);

        for player in players {
            if let Some(wheel) = player.wheel {
                sim.add_racer(player.player_uuid, wheel);
            }
        }

        races.insert(room_id, sim);
        Ok(())
    }

    /// Start the countdown for a race
    pub async fn start_countdown(&self, room_id: Uuid, duration_ms: u64) -> Result<()> {
        let mut races = self.races.write().await;
        let sim = races.get_mut(&room_id)
            .context("Race not found")?;
        sim.start_countdown(duration_ms);
        Ok(())
    }

    /// Start a race (after countdown completes)
    pub async fn start_race(&self, room_id: Uuid) -> Result<()> {
        let mut races = self.races.write().await;
        let sim = races.get_mut(&room_id)
            .context("Race not found")?;
        sim.start_race();
        Ok(())
    }

    /// Handle a wheel swap during a race
    pub async fn handle_wheel_swap(&self, room_id: Uuid, player_uuid: Uuid, swap_tick: u32, wheel: Vec<(i16, i16)>) -> Result<()> {
        let mut races = self.races.write().await;
        let sim = races.get_mut(&room_id)
            .context("Race not found")?;
        sim.handle_wheel_swap(player_uuid, swap_tick, wheel)?;
        Ok(())
    }

    /// Step all active races and collect state updates
    pub async fn step_all(&self) -> HashMap<Uuid, Vec<RacerState>> {
        let mut races = self.races.write().await;
        let mut updates = HashMap::new();

        for (room_id, sim) in races.iter_mut() {
            if sim.state() == RaceState::Racing {
                let states = sim.step();
                if !states.is_empty() {
                    updates.insert(*room_id, states);
                }
            }
        }

        updates
    }

    /// Get finish times for a completed race
    pub async fn get_finish_times(&self, room_id: Uuid) -> Option<HashMap<Uuid, u32>> {
        let races = self.races.read().await;
        races.get(&room_id).map(|sim| sim.finish_times())
    }

    /// Remove a completed race
    pub async fn remove_race(&self, room_id: Uuid) {
        let mut races = self.races.write().await;
        races.remove(&room_id);
        metrics::gauge!("drawrace_races_active").decrement(1.0);
    }

    /// Get the count of active races
    pub async fn race_count(&self) -> usize {
        self.races.read().await.len()
    }
}

impl Default for RaceExecutor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_race_simulator_creation() {
        let room_id = Uuid::new_v4();
        let sim = RaceSimulator::new(room_id, 1);
        assert_eq!(sim.room_id, room_id);
        assert_eq!(sim.track_id, 1);
        assert_eq!(sim.state(), RaceState::Waiting);
        assert_eq!(sim.racer_count(), 0);
    }

    #[test]
    fn test_add_racer() {
        let room_id = Uuid::new_v4();
        let mut sim = RaceSimulator::new(room_id, 1);
        let player_uuid = Uuid::new_v4();
        let wheel = vec![(0, 0), (10, 0), (10, 10), (0, 10)];

        sim.add_racer(player_uuid, wheel.clone());
        assert_eq!(sim.racer_count(), 1);

        let racer = sim.racers.get(&player_uuid).unwrap();
        assert_eq!(racer.player_uuid, player_uuid);
        assert_eq!(racer.wheel, wheel);
    }

    #[test]
    fn test_wheel_swap() {
        let room_id = Uuid::new_v4();
        let mut sim = RaceSimulator::new(room_id, 1);
        let player_uuid = Uuid::new_v4();
        let wheel1 = vec![(0, 0), (10, 0), (10, 10), (0, 10)];
        let wheel2 = vec![(0, 0), (5, 0), (5, 5), (0, 5)];

        sim.add_racer(player_uuid, wheel1);
        sim.start_race();

        sim.handle_wheel_swap(player_uuid, 100, wheel2).unwrap();
        let racer = sim.racers.get(&player_uuid).unwrap();
        assert_eq!(racer.wheel_swaps.len(), 1);
        assert_eq!(racer.wheel_swaps[0].0, 100);
    }

    #[test]
    fn test_race_states() {
        let room_id = Uuid::new_v4();
        let mut sim = RaceSimulator::new(room_id, 1);

        assert_eq!(sim.state(), RaceState::Waiting);
        sim.start_countdown(3000);
        assert_eq!(sim.state(), RaceState::CountingDown);
        sim.start_race();
        assert_eq!(sim.state(), RaceState::Racing);
    }

    #[tokio::test]
    async fn test_executor() {
        let executor = RaceExecutor::new();
        assert_eq!(executor.race_count().await, 0);
    }
}
