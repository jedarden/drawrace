#!/usr/bin/env npx tsx
import {
  createHeadlessRace,
  type TrackDef,
  type WheelDef,
} from "../src/headless-race.js";
import { PHYSICS_VERSION } from "../src/version.js";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEST_TRACK: TrackDef = {
  id: "hills-01",
  world: { gravity: [0, 10], pixelsPerMeter: 30 },
  terrain: [
    [0, 5], [5, 5], [10, 5.3], [15, 5.3],
    [18, 5.8], [22, 5.8], [25, 5], [30, 5],
    [35, 5.2], [40, 5.2],
  ],
  start: { pos: [1.5, 3.5], facing: 1 },
  finish: { pos: [39, 3.5], width: 0.2 },
};

function makeCircle(radius: number, n: number): [number, number][] {
  const verts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    verts.push([
      Math.round(radius * Math.cos(angle) * 1000) / 1000,
      Math.round(radius * Math.sin(angle) * 1000) / 1000,
    ]);
  }
  return verts;
}

const CIRCLE_WHEEL: WheelDef = { vertices: makeCircle(0.8, 16) };

const seeds = [42, 100, 999];

const goldens = seeds.map((seed) => {
  const result = createHeadlessRace({ seed, track: TEST_TRACK, wheel: CIRCLE_WHEEL });
  return {
    seed,
    trackId: TEST_TRACK.id,
    finishTicks: result.finishTicks,
    finalX: result.finalX,
    streamHash: result.streamHash,
    physicsVersion: PHYSICS_VERSION,
  };
});

const outDir = join(__dirname, "..", "golden");
mkdirSync(outDir, { recursive: true });

writeFileSync(
  join(outDir, "wheels.json"),
  JSON.stringify({ physicsVersion: PHYSICS_VERSION, goldens }, null, 2) + "\n"
);

console.log(`Generated ${goldens.length} golden entries (PHYSICS_VERSION=${PHYSICS_VERSION})`);
for (const g of goldens) {
  console.log(`  seed=${g.seed} ticks=${g.finishTicks} hash=${g.streamHash} finalX=${g.finalX.toFixed(2)}`);
}
