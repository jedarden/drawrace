#!/usr/bin/env node
/**
 * Generate snapshot fixture JSON for Layer 3 rendering tests.
 *
 * This script:
 * 1. Runs a deterministic race simulation
 * 2. Records all frames
 * 3. Extracts snapshot frames at deterministic ticks
 * 4. Writes to fixtures/snapshot-fixture.json
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { RaceSim } from "../src/race-sim.js";
import { processDraw } from "../src/draw-pipeline.js";
import { extractSnapshotFrames, type ReplayRecording } from "../src/replay-driver.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEST_TRACK = {
  id: "hills-01",
  world: { gravity: [0, 10], pixelsPerMeter: 30 },
  terrain: [
    [0, 5],
    [5, 5],
    [10, 5.3],
    [15, 5.3],
    [18, 5.8],
    [22, 5.8],
    [25, 5],
    [30, 5],
    [35, 5.2],
    [40, 5.2],
  ],
  start: { pos: [1.5, 3.5], facing: 1 },
  finish: { pos: [39, 3.5], width: 0.2 },
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

// Generate a circle drawing that becomes the wheel
const rawPoints = makeCircle(150, 150, 80, 60);
const totalTravel = rawPoints.reduce((acc, p, i, arr) => {
  if (i === 0) return 0;
  return acc + Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y);
}, 0);

const wheelDraw = processDraw(rawPoints, totalTravel);
if (!wheelDraw) {
  throw new Error("Failed to process wheel drawing");
}

// Extract vertices in world units (pixels → meters relative to centroid)
// The processDraw returns vertices in drawing coordinates (CSS pixels)
// We need to center them at (0,0) for the simulation
const cx = wheelDraw.centroid.x;
const cy = wheelDraw.centroid.y;
const wheelVertices = wheelDraw.vertices.map((v) => ({
  x: v.x - cx,
  y: v.y - cy,
}));

// Run the simulation and record frames
const sim = new RaceSim(TEST_TRACK, wheelVertices, 42);
sim.enableMotor();

const frames: Array<{
  wheel: { x: number; y: number; angle: number };
  chassis: { x: number; y: number; angle: number };
  rearWheel: { x: number; y: number; angle: number };
  tick: number;
  elapsedMs: number;
  finished: boolean;
}> = [];

// Capture initial state (tick 0) before any steps
const initialSnap = sim.snapshot();
frames.push({
  wheel: { ...initialSnap.wheel },
  chassis: { ...initialSnap.chassis },
  rearWheel: { ...initialSnap.rearWheel },
  tick: 0,
  elapsedMs: 0,
  finished: false,
});

let finishTick: number | null = null;

while (!sim.isFinished() && frames.length < 60 * 180) {
  const snap = sim.step();
  if (snap.finished && finishTick === null) {
    finishTick = snap.tick;
  }
  frames.push({
    wheel: { ...snap.wheel },
    chassis: { ...snap.chassis },
    rearWheel: { ...snap.rearWheel },
    tick: snap.tick,
    elapsedMs: snap.elapsedMs,
    finished: snap.finished,
  });
}

// Create full recording
const fullRecording: ReplayRecording = {
  track: TEST_TRACK,
  wheelDraw,
  frames,
};

// Extract snapshot frames
const snapshotRecording = extractSnapshotFrames(fullRecording);

// Write both full and snapshot fixtures
const fixturesDir = join(__dirname, "..", "fixtures");
const snapshotPath = join(fixturesDir, "snapshot-fixture.json");

writeFileSync(snapshotPath, JSON.stringify(snapshotRecording, null, 2), "utf-8");

console.log(`Generated snapshot fixture with ${snapshotRecording.frames.length} frames`);
console.log(`Snapshot ticks:`, snapshotRecording.frames.map((f) => f.tick));
console.log(`Written to: ${snapshotPath}`);
