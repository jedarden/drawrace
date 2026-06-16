import { it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { RaceSim } from "./race-sim.js";
import type { TrackDef } from "./headless-race.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadTrack(name: string): TrackDef {
  return JSON.parse(readFileSync(join(__dirname, `../../../apps/web/public/tracks/${name}.json`), "utf8")) as TrackDef;
}

function makeCircle(r: number, n: number) {
  const verts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    verts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return verts;
}

// MAX_R cap applied in RaceScreen.tsx — regression test to ensure a max-size circle
// can complete every deployed track without DNF/stuck.
const MAX_R = 0.65;
const MIN_R = 0.3;

it("circle at MAX_R completes hills-01 without DNF", { timeout: 30000 }, () => {
  const track = loadTrack("hills-01");
  const sim = new RaceSim(track, makeCircle(MAX_R, 12), 42);
  sim.enableMotor();
  let snap = sim.snapshot();
  for (let _i = 0; _i < 10800; _i++) {
    snap = sim.step();
    if (snap.finished) break;
  }
  expect(snap.finished).toBe(true);
  expect(snap.dnf).toBe(false);
  expect(snap.stuck).toBe(false);
  expect(snap.wheel.x).toBeGreaterThan(39);
});

it("circle at MIN_R completes hills-01 without DNF", { timeout: 30000 }, () => {
  const track = loadTrack("hills-01");
  const sim = new RaceSim(track, makeCircle(MIN_R, 8), 42);
  sim.enableMotor();
  let snap = sim.snapshot();
  for (let _i = 0; _i < 10800; _i++) {
    snap = sim.step();
    if (snap.finished) break;
  }
  expect(snap.finished).toBe(true);
  expect(snap.dnf).toBe(false);
  expect(snap.stuck).toBe(false);
  expect(snap.wheel.x).toBeGreaterThan(39);
});
