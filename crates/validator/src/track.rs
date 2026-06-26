/// Track data loading and conversion to WASM ABI format.
///
/// This module loads track JSON files from the versioned track store
/// and converts them to the terrain/obstacle format expected by the
/// WASM re-simulation engine.
use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;

use crate::wasm_abi::{Obstacle, ObstacleType};

/// Track JSON structure (matches client format)
#[derive(Debug, Deserialize)]
pub struct TrackJson {
    pub id: String,
    pub numeric_id: u16,
    pub name: String,
    pub version: u32,
    pub terrain: Vec<[f32; 2]>,
    pub obstacles: Vec<TrackObstacle>,
    pub surfaces: Vec<TrackSurface>,
    pub ramps: Vec<TrackRamp>,
    pub start: TrackStart,
    pub finish: TrackFinish,
    #[serde(default)]
    pub hazards: Vec<TrackHazard>,
}

#[derive(Debug, Deserialize)]
pub struct TrackObstacle {
    #[serde(rename = "type")]
    pub obstacle_type: String,
    pub pos: [f32; 2],
    pub size: [f32; 2],
}

#[derive(Debug, Deserialize)]
pub struct TrackSurface {
    pub x_range: [f32; 2],
    #[serde(rename = "type")]
    pub surface_type: String,
}

#[derive(Debug, Deserialize)]
pub struct TrackRamp {
    pub zone: String,
    pub x_start: f32,
    pub x_end: f32,
}

#[derive(Debug, Deserialize)]
pub struct TrackStart {
    pub pos: [f32; 2],
    pub facing: i32,
}

#[derive(Debug, Deserialize)]
pub struct TrackFinish {
    pub pos: [f32; 2],
    pub width: f32,
}

#[derive(Debug, Deserialize)]
pub struct TrackHazard {
    #[serde(rename = "type")]
    pub hazard_type: String,
    pub x_start: f32,
    pub x_end: f32,
    pub y: f32,
}

/// Loaded track data ready for WASM ABI
#[derive(Debug, Clone)]
pub struct TrackData {
    /// Track ID (numeric_id from JSON)
    pub track_id: u16,
    /// Terrain points as (x, y) pairs
    pub terrain: Vec<(f32, f32)>,
    /// Obstacles converted to WASM format
    pub obstacles: Vec<Obstacle>,
    /// Start position (x, y)
    pub start_x: f32,
    pub start_y: f32,
    /// Finish position (x, y)
    pub finish_x: f32,
    pub finish_y: f32,
}

/// Track store - caches loaded tracks by numeric_id
pub struct TrackStore {
    tracks: HashMap<u16, TrackData>,
}

impl TrackStore {
    /// Load the track store from the given directory.
    ///
    /// The directory should contain track JSON files named like:
    /// - hills-01.json
    /// - canyon-02.json
    /// - dunes-03.json
    pub fn load(tracks_dir: PathBuf) -> Result<Self> {
        let mut store = Self {
            tracks: HashMap::new(),
        };

        // Load all track JSON files from the directory
        let entries = std::fs::read_dir(&tracks_dir).with_context(|| {
            format!("Failed to read tracks directory: {}", tracks_dir.display())
        })?;

        for entry in entries {
            let entry = entry.context("Failed to read directory entry")?;
            let path = entry.path();

            // Skip directories and non-JSON files
            if path.is_dir() {
                continue;
            }
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }

            // Load the track JSON
            let json_str = std::fs::read_to_string(&path)
                .with_context(|| format!("Failed to read track file: {}", path.display()))?;

            let track_json: TrackJson = serde_json::from_str(&json_str)
                .with_context(|| format!("Failed to parse track JSON: {}", path.display()))?;

            // Convert to TrackData
            let track_data = Self::convert_track(&track_json)?;

            // Store by numeric_id
            store.tracks.insert(track_data.track_id, track_data);

            tracing::debug!(
                track_id = track_json.numeric_id,
                name = %track_json.name,
                "Loaded track from {}",
                path.display()
            );
        }

        if store.tracks.is_empty() {
            anyhow::bail!("No track files found in {}", tracks_dir.display());
        }

        tracing::info!(
            count = store.tracks.len(),
            dir = %tracks_dir.display(),
            "Loaded track store"
        );

        Ok(store)
    }

    /// Convert TrackJson to TrackData (WASM ABI format)
    fn convert_track(json: &TrackJson) -> Result<TrackData> {
        // Convert terrain: the JSON format uses [x_index, y_value] where
        // x_index is an integer index. Convert to actual (x, y) coordinates.
        let terrain: Vec<(f32, f32)> = json
            .terrain
            .iter()
            .map(|point| (point[0], point[1]))
            .collect();

        // Convert obstacles
        let mut obstacles = Vec::new();
        for obs in &json.obstacles {
            let obstacle_type = match obs.obstacle_type.as_str() {
                "box" => ObstacleType::Box,
                "circle" => ObstacleType::Circle,
                _ => {
                    tracing::warn!(
                        track = %json.id,
                        unknown_type = %obs.obstacle_type,
                        "Unknown obstacle type, defaulting to box"
                    );
                    ObstacleType::Box
                }
            };

            obstacles.push(Obstacle {
                obstacle_type,
                pos_x: obs.pos[0],
                pos_y: obs.pos[1],
                size_x: obs.size[0],
                size_y: obs.size[1],
                radius: 0.0,
                angle: 0.0,
                friction: 0.8,
            });
        }

        // Note: surfaces, ramps, and hazards are not yet supported by the
        // WASM resim engine. They're loaded here for future use but not
        // passed to the physics simulation.

        let start_x = json.start.pos[0];
        let start_y = json.start.pos[1];
        let finish_x = json.finish.pos[0];
        let finish_y = json.finish.pos[1];

        Ok(TrackData {
            track_id: json.numeric_id,
            terrain,
            obstacles,
            start_x,
            start_y,
            finish_x,
            finish_y,
        })
    }

    /// Get track data by numeric ID
    pub fn get(&self, track_id: u16) -> Option<&TrackData> {
        self.tracks.get(&track_id)
    }

    /// Get all loaded track IDs
    pub fn track_ids(&self) -> Vec<u16> {
        let mut ids: Vec<u16> = self.tracks.keys().copied().collect();
        ids.sort();
        ids
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_track() {
        let json_str = r#"{
            "id": "test-01",
            "numeric_id": 99,
            "name": "Test Track",
            "version": 1,
            "terrain": [[0, 0.0], [10, 1.0], [20, 0.5]],
            "obstacles": [
                {"type": "box", "pos": [5.0, 0.5], "size": [0.3, 0.15]},
                {"type": "circle", "pos": [15.0, 0.75], "size": [0.2, 0.2]}
            ],
            "surfaces": [],
            "ramps": [],
            "start": {"pos": [1.0, 0.0], "facing": 1},
            "finish": {"pos": [20.0, 0.5], "width": 0.2},
            "hazards": []
        }"#;

        let track_json: TrackJson = serde_json::from_str(json_str).unwrap();
        let track_data = TrackStore::convert_track(&track_json).unwrap();

        assert_eq!(track_data.track_id, 99);
        assert_eq!(
            track_data.terrain,
            vec![(0.0, 0.0), (10.0, 1.0), (20.0, 0.5)]
        );
        assert_eq!(track_data.obstacles.len(), 2);
        assert_eq!(track_data.start_x, 1.0);
        assert_eq!(track_data.start_y, 0.0);
        assert_eq!(track_data.finish_x, 20.0);
        assert_eq!(track_data.finish_y, 0.5);

        // Check first obstacle (box)
        let obs0 = &track_data.obstacles[0];
        assert!(matches!(obs0.obstacle_type, ObstacleType::Box));
        assert_eq!(obs0.pos_x, 5.0);
        assert_eq!(obs0.pos_y, 0.5);
        assert_eq!(obs0.size_x, 0.3);
        assert_eq!(obs0.size_y, 0.15);

        // Check second obstacle (circle)
        let obs1 = &track_data.obstacles[1];
        assert!(matches!(obs1.obstacle_type, ObstacleType::Circle));
        assert_eq!(obs1.pos_x, 15.0);
        assert_eq!(obs1.pos_y, 0.75);
    }
}
