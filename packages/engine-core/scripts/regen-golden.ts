#!/usr/bin/env npx tsx
import {
  createHeadlessRace,
  type TrackDef,
  type WheelDef,
} from "../src/headless-race.js";
import { runHeadless } from "../src/headless.js";
import type { WheelSwap } from "../src/swap.js";
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

// ---------------------------------------------------------------------------
// Wheel shape helpers
// ---------------------------------------------------------------------------

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

function makeEllipse(a: number, b: number, n: number): [number, number][] {
  const verts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    verts.push([
      Math.round(a * Math.cos(angle) * 1000) / 1000,
      Math.round(b * Math.sin(angle) * 1000) / 1000,
    ]);
  }
  return verts;
}

function makeRegularPolygon(sides: number, radius: number): [number, number][] {
  const verts: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides - Math.PI / 2;
    verts.push([
      Math.round(radius * Math.cos(angle) * 1000) / 1000,
      Math.round(radius * Math.sin(angle) * 1000) / 1000,
    ]);
  }
  return verts;
}

function makeStar(points: number, inner: number, outer: number): [number, number][] {
  const verts: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const angle = (Math.PI * i) / points - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    verts.push([
      Math.round(r * Math.cos(angle) * 1000) / 1000,
      Math.round(r * Math.sin(angle) * 1000) / 1000,
    ]);
  }
  return verts;
}

function makeCrescent(outerR: number, innerR: number, offset: number): [number, number][] {
  const n = 12;
  const verts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    verts.push([
      Math.round(outerR * Math.cos(angle) * 1000) / 1000,
      Math.round(outerR * Math.sin(angle) * 1000) / 1000,
    ]);
  }
  for (let i = n - 1; i >= 0; i--) {
    const angle = (2 * Math.PI * i) / n;
    verts.push([
      Math.round((innerR * Math.cos(angle) + offset) * 1000) / 1000,
      Math.round(innerR * Math.sin(angle) * 1000) / 1000,
    ]);
  }
  return verts;
}

function makeBlob(seed: number, n: number, baseR: number): [number, number][] {
  let s = seed;
  function rand() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  }
  const verts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    const r = baseR * (0.6 + 0.8 * rand());
    verts.push([
      Math.round(r * Math.cos(angle) * 1000) / 1000,
      Math.round(r * Math.sin(angle) * 1000) / 1000,
    ]);
  }
  return verts;
}

function makeFigure8(n: number, size: number): [number, number][] {
  const verts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    verts.push([
      Math.round(size * Math.sin(t) * 1000) / 1000,
      Math.round((size * Math.sin(t) * Math.cos(t)) * 1000) / 1000,
    ]);
  }
  return verts;
}

// ---------------------------------------------------------------------------
// Single-wheel golden entries (§Testing 3 reference library)
// ---------------------------------------------------------------------------

interface WheelEntry {
  id: string;
  wheel: WheelDef;
}

const WHEELS: WheelEntry[] = [
  { id: "circ-32-r40", wheel: { vertices: makeCircle(0.4, 32) } },
  { id: "circ-32-r20", wheel: { vertices: makeCircle(0.2, 32) } },
  { id: "circ-32-r80", wheel: { vertices: makeCircle(0.8, 32) } },
  { id: "circ-16-r80", wheel: { vertices: makeCircle(0.8, 16) } },
  { id: "circ-08-r80", wheel: { vertices: makeCircle(0.8, 8) } },
  { id: "circ-24-r60", wheel: { vertices: makeCircle(0.6, 24) } },
  { id: "oval-slim", wheel: { vertices: makeEllipse(0.5, 0.3, 24) } },
  { id: "oval-fat", wheel: { vertices: makeEllipse(0.4, 0.55, 24) } },
  { id: "tri-equi-40", wheel: { vertices: makeRegularPolygon(3, 0.4) } },
  { id: "tri-right", wheel: { vertices: [[0, 0], [0.6, 0], [0.3, 0.5]] as [number, number][] } },
  { id: "square-40", wheel: { vertices: makeRegularPolygon(4, 0.4) } },
  { id: "rect-wide", wheel: { vertices: [[-0.4, -0.2], [0.4, -0.2], [0.4, 0.2], [-0.4, 0.2]] as [number, number][] } },
  { id: "penta-40", wheel: { vertices: makeRegularPolygon(5, 0.4) } },
  { id: "hexa-40", wheel: { vertices: makeRegularPolygon(6, 0.4) } },
  { id: "star-5-sharp", wheel: { vertices: makeStar(5, 0.15, 0.45) } },
  { id: "star-5-soft", wheel: { vertices: makeStar(5, 0.3, 0.45) } },
  { id: "star-4", wheel: { vertices: makeStar(4, 0.2, 0.4) } },
  { id: "crescent-a", wheel: { vertices: makeCrescent(0.4, 0.35, 0.15) } },
  { id: "blob-self-intx-1", wheel: { vertices: makeBlob(1, 16, 0.4) } },
  { id: "blob-self-intx-2", wheel: { vertices: makeBlob(2, 20, 0.35) } },
  { id: "blob-smooth", wheel: { vertices: makeBlob(42, 24, 0.5) } },
  { id: "figure8-sm", wheel: { vertices: makeFigure8(24, 0.3) } },
  { id: "figure8-lg", wheel: { vertices: makeFigure8(32, 0.5) } },
];

const SEED = 42;

interface GoldenEntry {
  id: string;
  seed: number;
  trackId: string;
  wheel: WheelDef;
  finishTicks: number;
  finalX: number;
  streamHash: string;
  physicsVersion: number;
}

const goldens: GoldenEntry[] = WHEELS.map((entry) => {
  const result = createHeadlessRace({ seed: SEED, track: TEST_TRACK, wheel: entry.wheel });
  return {
    id: entry.id,
    seed: SEED,
    trackId: TEST_TRACK.id,
    wheel: entry.wheel,
    finishTicks: result.finishTicks,
    finalX: result.finalX,
    streamHash: result.streamHash,
    physicsVersion: PHYSICS_VERSION,
  };
});

// ---------------------------------------------------------------------------
// Multi-wheel (swap) golden entries
// ---------------------------------------------------------------------------

// Convenience shapes for swap scenarios
const CIRC_8 = makeCircle(0.4, 8);
const CIRC_32 = makeCircle(0.4, 32);
const TRI = makeRegularPolygon(3, 0.4);
const HEX = makeRegularPolygon(6, 0.4);
const SQUA = makeRegularPolygon(4, 0.4);

interface SwapGoldenEntry {
  id: string;
  seed: number;
  trackId: string;
  wheels: WheelSwap[];
  finishTicks: number;
  finalX: number;
  streamHash: string;
  physicsVersion: number;
}

const SWAP_SCENARIOS: Array<{ id: string; wheels: WheelSwap[] }> = [
  // Swap at tick 0 only — must match single-wheel result for the same polygon
  {
    id: "swap-tick0-only",
    wheels: [{ swap_tick: 0, polygon: CIRC_32 }],
  },
  // Circle → triangle at tick 60 (1s in)
  {
    id: "swap-circ-to-tri-t60",
    wheels: [
      { swap_tick: 0, polygon: CIRC_8 },
      { swap_tick: 60, polygon: TRI },
    ],
  },
  // Triangle → circle at tick 120
  {
    id: "swap-tri-to-circ-t120",
    wheels: [
      { swap_tick: 0, polygon: TRI },
      { swap_tick: 120, polygon: CIRC_8 },
    ],
  },
  // 3-swap chain: circle → hex → square
  {
    id: "swap-chain-3",
    wheels: [
      { swap_tick: 0, polygon: CIRC_8 },
      { swap_tick: 60, polygon: HEX },
      { swap_tick: 180, polygon: SQUA },
    ],
  },
  // 5-swap seeded determinism reference (§Testing 3)
  {
    id: "swap-5-determinism",
    wheels: [
      { swap_tick: 0, polygon: CIRC_8 },
      { swap_tick: 60, polygon: TRI },
      { swap_tick: 120, polygon: CIRC_8 },
      { swap_tick: 180, polygon: TRI },
      { swap_tick: 240, polygon: CIRC_8 },
    ],
  },
  // Position-continuity probe: swap at tick 500 with two distinct shapes
  {
    id: "swap-position-continuity",
    wheels: [
      { swap_tick: 0, polygon: CIRC_32 },
      { swap_tick: 500, polygon: HEX },
    ],
  },
];

const swapGoldens: SwapGoldenEntry[] = SWAP_SCENARIOS.map((scenario) => {
  const result = runHeadless({ seed: SEED, track: TEST_TRACK, wheels: scenario.wheels });
  return {
    id: scenario.id,
    seed: SEED,
    trackId: TEST_TRACK.id,
    wheels: scenario.wheels,
    finishTicks: result.finishTicks,
    finalX: result.finalX,
    streamHash: result.streamHash,
    physicsVersion: PHYSICS_VERSION,
  };
});

// ---------------------------------------------------------------------------
// Write output files
// ---------------------------------------------------------------------------

const outDir = join(__dirname, "..", "golden");
mkdirSync(outDir, { recursive: true });

writeFileSync(
  join(outDir, "wheels.json"),
  JSON.stringify({ physicsVersion: PHYSICS_VERSION, goldens }, null, 2) + "\n",
);

writeFileSync(
  join(outDir, "swaps.json"),
  JSON.stringify({ physicsVersion: PHYSICS_VERSION, swapGoldens }, null, 2) + "\n",
);

console.log(`Generated ${goldens.length} single-wheel golden entries (PHYSICS_VERSION=${PHYSICS_VERSION})`);
for (const g of goldens) {
  const dnf = g.finishTicks >= 60 * 180 ? " DNF" : "";
  console.log(`  ${g.id} ticks=${g.finishTicks} hash=${g.streamHash} finalX=${g.finalX.toFixed(2)}${dnf}`);
}

console.log(`\nGenerated ${swapGoldens.length} swap golden entries:`);
for (const g of swapGoldens) {
  const dnf = g.finishTicks >= 60 * 180 ? " DNF" : "";
  console.log(`  ${g.id} ticks=${g.finishTicks} hash=${g.streamHash} finalX=${g.finalX.toFixed(2)}${dnf}`);
}
