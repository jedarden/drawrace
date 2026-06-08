#!/usr/bin/env tsx

/**
 * Debug script to investigate why resim returns 1 tick for all ghosts.
 */

import { readFileSync } from "fs";
import { join } from "path";

// Load reference ghosts
const ghostsPath = join(process.cwd(), "crates/validator/reference-ghosts.json");
const ghostsData = JSON.parse(readFileSync(ghostsPath, "utf-8"));

// Load track data
const trackPath = join(process.cwd(), "apps/web/public/tracks/hills-01.json");
const trackData = JSON.parse(readFileSync(trackPath, "utf-8"));

console.log("=== Track Data ===");
console.log("Start:", trackData.start);
console.log("Finish:", trackData.finish);
console.log("Terrain (first 5 points):", trackData.terrain.slice(0, 5));
console.log("");

// Get first ghost
const firstGhostId = Object.keys(ghostsData.ghosts)[0];
const ghost = ghostsData.ghosts[firstGhostId];

console.log(`=== Ghost: ${firstGhostId} ===`);
console.log("Track ID:", ghost.track_id);
console.log("Finish time ms:", ghost.finish_time_ms);
console.log("Expected finish ticks:", Math.floor(ghost.finish_time_ms * 60 / 1000));
console.log("");

// Calculate wheel radius from vertices
const wheel = ghost.wheels[0];
console.log("=== Wheel Analysis ===");
console.log("Vertex count:", wheel.vertex_count);
console.log("First 3 vertices:", wheel.polygon_vertices.slice(0, 3));

// Find max distance from origin (radius in hundredths of meter)
let maxDistSq = 0;
for (const [x, y] of wheel.polygon_vertices) {
  const distSq = x * x + y * y;
  if (distSq > maxDistSq) maxDistSq = distSq;
}
const radiusHundredths = Math.sqrt(maxDistSq);
const radiusMeters = radiusHundredths / 100;

console.log("Max distance (hundredths):", radiusHundredths);
console.log("Wheel radius (meters):", radiusMeters.toFixed(4));
console.log("");

// Calculate expected velocity
const MOTOR_SPEED = 8.0; // rad/s
const EFFICIENCY = 0.795;
const velocity = MOTOR_SPEED * radiusMeters * EFFICIENCY;
console.log("=== Expected Physics ===");
console.log("Motor speed (rad/s):", MOTOR_SPEED);
console.log("Efficiency:", EFFICIENCY);
console.log("Velocity (m/s):", velocity.toFixed(4));
console.log("");

// Calculate race parameters
const start_x = trackData.start.pos[0];
const start_y = trackData.start.pos[1];
const finish_x = trackData.finish.pos[0];
const finish_y = trackData.finish.pos[1];

const distance = finish_x - start_x;
const expectedTime = distance / velocity;
const expectedTicks = expectedTime * 60;

console.log("=== Race Parameters ===");
console.log("Start X:", start_x);
console.log("Start Y:", start_y);
console.log("Finish X:", finish_x);
console.log("Finish Y:", finish_y);
console.log("Distance (m):", distance.toFixed(2));
console.log("Expected time (s):", expectedTime.toFixed(2));
console.log("Expected ticks:", Math.round(expectedTicks));
console.log("Ghost claimed ticks:", Math.floor(ghost.finish_time_ms * 60 / 1000));
console.log("");

// Check terrain Y at start
const firstTerrainY = trackData.terrain[0][1];
console.log("=== Terrain Analysis ===");
console.log("First terrain Y:", firstTerrainY);
console.log("Start Y:", start_y);
console.log("Wheel on ground?", start_y === firstTerrainY);
console.log("");

// Calculate what radius would give the ghost's time
const ghostTicks = ghost.finish_time_ms / 1000 * 60;
const ghostVelocity = distance / (ghost.finish_time_ms / 1000);
const ghostRadius = ghostVelocity / (MOTOR_SPEED * EFFICIENCY);
console.log("=== Inverse Calculation from Ghost Time ===");
console.log("Ghost ticks:", Math.round(ghostTicks));
console.log("Required velocity (m/s):", ghostVelocity.toFixed(4));
console.log("Required wheel radius (m):", ghostRadius.toFixed(4));
console.log("Required wheel radius (hundredths):", (ghostRadius * 100).toFixed(2));
