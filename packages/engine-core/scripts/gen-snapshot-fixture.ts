#!/usr/bin/env node
/**
 * Generate snapshot fixture JSON for Layer 3 rendering tests.
 *
 * This script:
 * 1. Runs a deterministic race simulation
 * 2. Records all frames
 * 3. Extracts snapshot frames at deterministic ticks
 * 4. Includes the finish frame
 * 5. Writes to fixtures/snapshot-fixture.json
 */

import { writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { RaceSim } from "../src/race-sim.js";
import { processDraw } from "../src/draw-pipeline.js";
import { extractSnapshotFrames, type ReplayRecording } from "../src/replay-driver.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the actual hills-01 track from the public directory
const trackJsonPath = join(__dirname, "..", "..", "..", "apps", "web", "public", "tracks", "hills-01.json");
const trackData = JSON.parse(readFileSync(trackJsonPath, "utf-8"));

// Use first 14 terrain points (x=0..39) with finish at x=33.
// This gives a ~10s race (600+ ticks) so all 5 checkpoints (0,30,120,300,finish)
// produce distinct frames.
const TEST_TRACK = {
  id: "hills-01",
  world: trackData.world,
  terrain: trackData.terrain.slice(0, 14),
  start: trackData.start,
  finish: { pos: [33.0, -0.1] as [number, number], width: 0.2 },
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

let finishFrame: typeof frames[0] | null = null;

// Run simulation until finish or max ticks
while (!sim.isFinished() && frames.length < 60 * 180) {
  const snap = sim.step();
  if (snap.finished && finishFrame === null) {
    finishFrame = {
      wheel: { ...snap.wheel },
      chassis: { ...snap.chassis },
      rearWheel: { ...snap.rearWheel },
      tick: snap.tick,
      elapsedMs: snap.elapsedMs,
      finished: true,
    };
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

// Extract 5 snapshot frames at deterministic ticks
const SNAPSHOT_TICKS = [0, 30, 120, 300];
const snapshotFrames = SNAPSHOT_TICKS.map((tick) => {
  for (const frame of frames) {
    if (frame.tick >= tick) return frame;
  }
  return frames[frames.length - 1];
});

// Append the finish frame (guaranteed distinct from tick-300)
if (finishFrame) {
  snapshotFrames.push(finishFrame);
} else {
  snapshotFrames.push(frames[frames.length - 1]);
}

const snapshotRecording: ReplayRecording = {
  track: TEST_TRACK,
  wheelDraw,
  frames: snapshotFrames,
};

// Write both full and snapshot fixtures
const fixturesDir = join(__dirname, "..", "fixtures");
const snapshotPath = join(fixturesDir, "snapshot-fixture.json");

writeFileSync(snapshotPath, JSON.stringify(snapshotRecording, null, 2), "utf-8");

console.log(`Generated snapshot fixture with ${snapshotRecording.frames.length} frames`);
console.log(`Snapshot ticks:`, snapshotRecording.frames.map((f) => f.tick));
console.log(`Written to: ${snapshotPath}`);
