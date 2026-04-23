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

// ---------------------------------------------------------------------------
// Reference wheel library — §Testing 3
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
  // Simple seeded noise for blob shapes
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

interface WheelEntry {
  id: string;
  wheel: WheelDef;
}

const WHEELS: WheelEntry[] = [
  // Circles
  { id: "circ-32-r40", wheel: { vertices: makeCircle(0.4, 32) } },
  { id: "circ-32-r20", wheel: { vertices: makeCircle(0.2, 32) } },
  { id: "circ-32-r80", wheel: { vertices: makeCircle(0.8, 32) } },
  { id: "circ-16-r80", wheel: { vertices: makeCircle(0.8, 16) } },
  { id: "circ-08-r80", wheel: { vertices: makeCircle(0.8, 8) } },
  { id: "circ-24-r60", wheel: { vertices: makeCircle(0.6, 24) } },

  // Ovals
  { id: "oval-slim", wheel: { vertices: makeEllipse(0.5, 0.3, 24) } },
  { id: "oval-fat", wheel: { vertices: makeEllipse(0.4, 0.55, 24) } },

  // Triangles
  { id: "tri-equi-40", wheel: { vertices: makeRegularPolygon(3, 0.4) } },
  { id: "tri-right", wheel: { vertices: [[0, 0], [0.6, 0], [0.3, 0.5]] as [number, number][] } },

  // Squares / rectangles
  { id: "square-40", wheel: { vertices: makeRegularPolygon(4, 0.4) } },
  { id: "rect-wide", wheel: { vertices: [[-0.4, -0.2], [0.4, -0.2], [0.4, 0.2], [-0.4, 0.2]] as [number, number][] } },

  // Pentagons / hexagons
  { id: "penta-40", wheel: { vertices: makeRegularPolygon(5, 0.4) } },
  { id: "hexa-40", wheel: { vertices: makeRegularPolygon(6, 0.4) } },

  // Stars
  { id: "star-5-sharp", wheel: { vertices: makeStar(5, 0.15, 0.45) } },
  { id: "star-5-soft", wheel: { vertices: makeStar(5, 0.3, 0.45) } },
  { id: "star-4", wheel: { vertices: makeStar(4, 0.2, 0.4) } },

  // Crescent
  { id: "crescent-a", wheel: { vertices: makeCrescent(0.4, 0.35, 0.15) } },

  // Blobs (self-intersecting-ish irregular shapes)
  { id: "blob-self-intx-1", wheel: { vertices: makeBlob(1, 16, 0.4) } },
  { id: "blob-self-intx-2", wheel: { vertices: makeBlob(2, 20, 0.35) } },
  { id: "blob-smooth", wheel: { vertices: makeBlob(42, 24, 0.5) } },

  // Figure-8 (self-intersecting)
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
  const result = createHeadlessRace({
    seed: SEED,
    track: TEST_TRACK,
    wheel: entry.wheel,
  });
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

const outDir = join(__dirname, "..", "golden");
mkdirSync(outDir, { recursive: true });

writeFileSync(
  join(outDir, "wheels.json"),
  JSON.stringify({ physicsVersion: PHYSICS_VERSION, goldens }, null, 2) + "\n",
);

console.log(`Generated ${goldens.length} golden entries (PHYSICS_VERSION=${PHYSICS_VERSION})`);
for (const g of goldens) {
  const dnf = g.finishTicks >= 60 * 180 ? " DNF" : "";
  console.log(`  ${g.id} ticks=${g.finishTicks} hash=${g.streamHash} finalX=${g.finalX.toFixed(2)}${dnf}`);
}
