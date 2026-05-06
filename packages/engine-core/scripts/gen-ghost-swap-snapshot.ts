#!/usr/bin/env node
/**
 * Generate snapshot fixture JSON for ghost wheel swap animation tests.
 *
 * This script:
 * 1. Runs a deterministic race simulation with a ghost
 * 2. Ghost has at least 1 mid-race wheel swap
 * 3. Records frames at start, mid-swap, and post-swap
 * 4. Writes to fixtures/ghost-swap-snapshot.json
 */

import { writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { RaceSim } from "../src/race-sim.js";
import { processDraw } from "../src/draw-pipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the actual hills-01 track from the public directory
const trackJsonPath = join(__dirname, "..", "..", "..", "apps", "web", "public", "tracks", "hills-01.json");
const trackData = JSON.parse(readFileSync(trackJsonPath, "utf-8"));

// Use first 14 terrain points (x=0..13) with finish at x=12.
const TEST_TRACK = {
  id: "hills-01",
  world: trackData.world,
  terrain: trackData.terrain.slice(0, 14),
  zones: [{ id: "1", x_start: 0, x_end: 13 }],
  start: trackData.start,
  finish: { pos: [12.0, 3.0] as [number, number], width: 0.2 },
};

function makeCircle(
  cx: number,
  cy: number,
  radius: number,
  n: number
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    pts.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }
  return pts;
}

function makeHexagon(
  cx: number,
  cy: number,
  radius: number
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 30; i++) {
    const angle = (2 * Math.PI * i) / 30;
    pts.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }
  return pts;
}

// Generate player wheel (circle)
const playerRawPoints = makeCircle(150, 150, 80, 60);
const playerTotalTravel = playerRawPoints.reduce((acc, p, i, arr) => {
  if (i === 0) return 0;
  return acc + Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y);
}, 0);

const playerWheelDraw = processDraw(playerRawPoints, playerTotalTravel);
if (!playerWheelDraw) {
  throw new Error("Failed to process player wheel drawing");
}

const pcx = playerWheelDraw.centroid.x;
const pcy = playerWheelDraw.centroid.y;
const playerVertices = playerWheelDraw.vertices.map((v) => ({
  x: v.x - pcx,
  y: v.y - pcy,
}));

// Generate ghost initial wheel (same as player)
const ghostRawPoints = makeCircle(150, 150, 80, 60);
const ghostTotalTravel = ghostRawPoints.reduce((acc, p, i, arr) => {
  if (i === 0) return 0;
  return acc + Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y);
}, 0);

const ghostWheelDraw = processDraw(ghostRawPoints, ghostTotalTravel);
if (!ghostWheelDraw) {
  throw new Error("Failed to process ghost wheel drawing");
}

const gcx = ghostWheelDraw.centroid.x;
const gcy = ghostWheelDraw.centroid.y;
const ghostVertices = ghostWheelDraw.vertices.map((v) => ({
  x: v.x - gcx,
  y: v.y - gcy,
}));

// Ghost swapped wheel (hexagon - different shape from circle)
const ghostSwapRawPoints = makeHexagon(150, 150, 80);
const ghostSwapTotalTravel = ghostSwapRawPoints.reduce((acc, p, i, arr) => {
  if (i === 0) return 0;
  return acc + Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y);
}, 0);

const ghostSwapWheelDraw = processDraw(ghostSwapRawPoints, ghostSwapTotalTravel);
if (!ghostSwapWheelDraw) {
  throw new Error("Failed to process ghost swap wheel drawing");
}

const gscx = ghostSwapWheelDraw.centroid.x;
const gscy = ghostSwapWheelDraw.centroid.y;
const ghostSwapVertices = ghostSwapWheelDraw.vertices.map((v) => ({
  x: v.x - gscx,
  y: v.y - gscy,
}));

// Run the simulation
const playerSim = new RaceSim(TEST_TRACK, playerVertices, 42);
const ghostSim = new RaceSim(TEST_TRACK, ghostVertices, 123);

// Ghost wheel swap at tick 100 (approximately 1.67 seconds into the race)
const GHOST_SWAP_TICK = 100;

const frames: Array<{
  player: {
    wheel: { x: number; y: number; angle: number };
    chassis: { x: number; y: number; angle: number };
    rearWheel: { x: number; y: number; angle: number };
  };
  ghost: {
    wheel: { x: number; y: number; angle: number };
    chassis: { x: number; y: number; angle: number };
    rearWheel: { x: number; y: number; angle: number };
  };
  tick: number;
  elapsedMs: number;
  ghostSwapProgress: number; // 0 = start of swap, 1 = end of swap
}> = [];

// Capture initial state (tick 0) before any steps
const initialPlayerSnap = playerSim.snapshot();
const initialGhostSnap = ghostSim.snapshot();
frames.push({
  player: {
    wheel: { ...initialPlayerSnap.wheel },
    chassis: { ...initialPlayerSnap.chassis },
    rearWheel: { ...initialPlayerSnap.rearWheel },
  },
  ghost: {
    wheel: { ...initialGhostSnap.wheel },
    chassis: { ...initialGhostSnap.chassis },
    rearWheel: { ...initialGhostSnap.rearWheel },
  },
  tick: 0,
  elapsedMs: 0,
  ghostSwapProgress: 1,
});

// Run simulation, capturing frames at key points
let swapStartTime = 0;
const SWAP_DURATION_MS = 200;

while (!playerSim.isFinished() && frames.length < 60 * 180) {
  const playerSnap = playerSim.step();
  const currentTick = playerSnap.tick;

  // Check if ghost should swap wheels at this tick
  if (currentTick === GHOST_SWAP_TICK) {
    ghostSim.swapWheel(ghostSwapVertices);
    swapStartTime = playerSnap.elapsedMs;
  }

  const ghostSnap = ghostSim.step();

  // Capture frames at key points
  const shouldCapture =
    currentTick === GHOST_SWAP_TICK - 10 || // Before swap
    currentTick === GHOST_SWAP_TICK || // At swap start
    currentTick === GHOST_SWAP_TICK + 5 || // During swap (83ms)
    currentTick === GHOST_SWAP_TICK + 10 || // During swap (167ms)
    currentTick === GHOST_SWAP_TICK + 12 || // During swap (~200ms - key frame for timing test)
    currentTick === GHOST_SWAP_TICK + 15 || // During swap (250ms)
    currentTick === GHOST_SWAP_TICK + 30; // Post-swap (500ms)

  if (shouldCapture) {
    // Calculate swap progress (0 to 1 over 200ms)
    const elapsedSinceSwap = playerSnap.elapsedMs - swapStartTime;
    const ghostSwapProgress = Math.min(1, Math.max(0, elapsedSinceSwap / SWAP_DURATION_MS));

    frames.push({
      player: {
        wheel: { ...playerSnap.wheel },
        chassis: { ...playerSnap.chassis },
        rearWheel: { ...playerSnap.rearWheel },
      },
      ghost: {
        wheel: { ...ghostSnap.wheel },
        chassis: { ...ghostSnap.chassis },
        rearWheel: { ...ghostSnap.rearWheel },
      },
      tick: currentTick,
      elapsedMs: playerSnap.elapsedMs,
      ghostSwapProgress,
    });
  }

  if (playerSnap.finished) {
    break;
  }
}

const snapshotFixture = {
  track: TEST_TRACK,
  playerWheelDraw,
  ghostWheelDraw,
  ghostSwapWheelDraw,
  ghostSwapTick: GHOST_SWAP_TICK,
  frames,
};

// Write fixture
const fixturesDir = join(__dirname, "..", "fixtures");
const snapshotPath = join(fixturesDir, "ghost-swap-snapshot.json");

writeFileSync(snapshotPath, JSON.stringify(snapshotFixture, null, 2), "utf-8");

console.log(`Generated ghost swap snapshot fixture with ${frames.length} frames`);
console.log(`Ghost swap tick: ${GHOST_SWAP_TICK}`);
console.log(`Frame ticks:`, frames.map((f) => f.tick));
console.log(`Written to: ${snapshotPath}`);
