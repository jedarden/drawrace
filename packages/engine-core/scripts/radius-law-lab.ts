/**
 * Radius-law evidence lab for drawrace-0238e6da (prerequisite of drawrace-d85f702c).
 *
 * Compares candidate motor radius laws for `motorSpeedForRadius`:
 *   A. constant MOTOR_SPEED (pre-compensation baseline)
 *   B. max-vertex radius (current worktree implementation)
 *   C. mean rolling radius = perimeter / 2π (physical rolling circumference)
 *
 * The ACTIVE law is whatever `wheelRadiusOf` in ../src/swap.ts implements right
 * now; run this script once per candidate by editing swap.ts between runs.
 *
 * Measures:
 *   1. diagnostic-wheel-spin scenarios: 12-gon / triangle / hexagon (r=0.8) on
 *      flat ground — chassis ΔX at the test's 30-tick window and at a longer
 *      120-tick steady-state window, plus final Vx.
 *   2. hills-01 (golden test track) finish ticks for key reference wheels,
 *      including triangle-family wheels that must still finish.
 *
 * Usage: npx tsx packages/engine-core/scripts/radius-law-lab.ts
 */
import { RaceSim } from "../src/race-sim.js";
import { runHeadless } from "../src/headless.js";
import type { TrackDef } from "../src/headless-race.js";
import * as swap from "../src/swap.js";
// Pre-compensation baseline does not export these; degrade gracefully so the
// same script measures both source states.
const wheelRadiusOf: (p: [number, number][]) => number =
  (swap as { wheelRadiusOf?: (p: [number, number][]) => number }).wheelRadiusOf ??
  ((p: [number, number][]) => {
    const v = p.length > 1 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1e-6 ? p.slice(0, -1) : p;
    const cx = v.reduce((s, q) => s + q[0], 0) / v.length;
    const cy = v.reduce((s, q) => s + q[1], 0) / v.length;
    return Math.max(...v.map((q) => Math.hypot(q[0] - cx, q[1] - cy)));
  });
const motorSpeedForRadius: (r: number) => number =
  (swap as { motorSpeedForRadius?: (r: number) => number }).motorSpeedForRadius ??
  (() => 8); // baseline constant MOTOR_SPEED

function circle(r: number, n: number): [number, number][] {
  const v: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    v.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return v;
}

// The three diagnostic-wheel-spin wheels (vertex centroids all at origin,
// all vertices at distance 0.8 — max-vertex and mean-vertex laws agree here,
// so this isolates the effect of compensation itself rather than law choice).
const W12 = circle(0.8, 12);
const TRI: [number, number][] = [[0.8, 0], [-0.4, 0.693], [-0.4, -0.693]];
const HEX = circle(0.8, 6);

const flatTrack = {
  id: "diagnostic-flat",
  world: { gravity: [0, 10] as [number, number], pixelsPerMeter: 80 },
  terrain: [[-10, 0], [100, 0]] as [number, number][],
  zones: [
    { id: "start", x_start: -10, x_end: 0 },
    { id: "race", x_start: 0, x_end: 100 },
  ] as Array<{ id: string; x_start: number; x_end: number }>,
  start: { pos: [0, -2] as [number, number], facing: 0 },
  finish: { pos: [50, 0] as [number, number], width: 10 },
};

// Golden-test hills-01 track (same geometry as golden/regenerate.ts)
const GOLDEN_TRACK: TrackDef = {
  id: "hills-01",
  world: { gravity: [0, 10], pixelsPerMeter: 30 },
  terrain: [
    [0, 5], [5, 5], [10, 5.3], [15, 5.3], [18, 5.8], [22, 5.8],
    [25, 5], [30, 5], [35, 5.2], [40, 5.2],
  ],
  zones: [{ id: "zone-a", x_start: 0, x_end: 40 }],
  start: { pos: [1.5, 3.5], facing: 1 },
  finish: { pos: [39, 3.5], width: 0.2 },
};

function regularPolygon(sides: number, radius: number): [number, number][] {
  const v: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides - Math.PI / 2;
    v.push([Math.round(radius * Math.cos(a) * 1000) / 1000, Math.round(radius * Math.sin(a) * 1000) / 1000]);
  }
  return v;
}

function star(points: number, inner: number, outer: number): [number, number][] {
  const v: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (Math.PI * i) / points - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    v.push([Math.round(r * Math.cos(a) * 1000) / 1000, Math.round(r * Math.sin(a) * 1000) / 1000]);
  }
  return v;
}

/** Perimeter of a closed polygon. */
function perimeter(poly: [number, number][]): number {
  let p = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
}

interface FlatResult {
  dx30: number;
  dx120: number;
  vx120: number;
  omega120: number;
}

function runFlat(wheel: [number, number][]): FlatResult {
  const sim = new RaceSim(flatTrack, wheel.map(([x, y]) => ({ x, y })));
  sim.enableMotor();
  let x30 = 0;
  let x120 = 0;
  let vx120 = 0;
  let om120 = 0;
  for (let i = 0; i < 120; i++) {
    sim.step();
    const d = sim.getDiagnosticData();
    if (i === 29) x30 = d.chassisX;
    if (i === 119) {
      x120 = d.chassisX;
      vx120 = d.chassisVelX;
      om120 = d.frontWheelAngVel;
    }
  }
  return { dx30: x30 - flatTrack.start.pos[0], dx120: x120 - flatTrack.start.pos[0], vx120, omega120: om120 };
}

console.log("=== Radius-law evidence lab ===");
console.log(
  `wheelRadiusOf(circle r=0.8 12gon) = ${wheelRadiusOf(W12).toFixed(4)}  ` +
  `motorSpeedForRadius = ${motorSpeedForRadius(wheelRadiusOf(W12)).toFixed(3)} rad/s`
);
console.log(
  `wheelRadiusOf(triangle diag)      = ${wheelRadiusOf(TRI).toFixed(4)}  ` +
  `motorSpeedForRadius = ${motorSpeedForRadius(wheelRadiusOf(TRI)).toFixed(3)} rad/s`
);
console.log(
  `perimeter-based radii: W12 P/(2π)=${(perimeter(W12) / (2 * Math.PI)).toFixed(4)}, ` +
  `TRI P/(2π)=${(perimeter(TRI) / (2 * Math.PI)).toFixed(4)}`
);

console.log("\n--- Flat-ground diagnostics (chassis ΔX from start) ---");
console.log("wheel    |  ω tgt |  ΔX@30 | ΔX@120 | Vx@120 |  ω@120");
for (const [name, w] of [["12-gon", W12], ["triangle", TRI], ["hexagon", HEX]] as const) {
  const r = runFlat(w as [number, number][]);
  const tgt = motorSpeedForRadius(wheelRadiusOf(w as [number, number][]));
  console.log(
    `${name.padEnd(8)} | ${tgt.toFixed(2).padStart(6)} | ${r.dx30.toFixed(3).padStart(6)} | ` +
    `${r.dx120.toFixed(3).padStart(6)} | ${r.vx120.toFixed(3).padStart(6)} | ${r.omega120.toFixed(3).padStart(6)}`
  );
}

console.log("\n--- Flat-ground linear top speed over 300 ticks (equalization check) ---");
const TOP_TRACK: TrackDef = {
  id: "flat-top-speed",
  world: { gravity: [0, 10], pixelsPerMeter: 30 },
  terrain: [[0, 5], [200, 5]],
  zones: [{ id: "A", x_start: 0, x_end: 200 }],
  start: { pos: [1.5, 3.5], facing: 1 },
  finish: { pos: [195, 3.5], width: 0.2 },
};
const topWheels: Array<[string, [number, number][]]> = [
  ["circle r=0.4", circle(0.4, 32)],
  ["circle r=0.8", circle(0.8, 32)],
  ["circle r=0.2", circle(0.2, 32)],
  ["tri equi r=0.4", regularPolygon(3, 0.4)],
  ["square r=0.4", regularPolygon(4, 0.4)],
  ["hexagon r=0.4", regularPolygon(6, 0.4)],
  ["star-5-sharp", star(5, 0.15, 0.45)],
  ["star-5-soft", star(5, 0.3, 0.45)],
];
console.log("wheel            | R(law) | ω tgt  | max |Vx| m/s");
let vMin = Infinity, vMax = -Infinity;
for (const [name, verts] of topWheels) {
  const sim = new RaceSim(TOP_TRACK, verts.map(([x, y]) => ({ x, y })));
  sim.enableMotor();
  let vmax = 0;
  for (let i = 0; i < 300; i++) {
    sim.step();
    const d = sim.getDiagnosticData();
    vmax = Math.max(vmax, Math.abs(d.chassisVelX));
  }
  vMin = Math.min(vMin, vmax);
  vMax = Math.max(vMax, vmax);
  const r = wheelRadiusOf(verts);
  const tgt = motorSpeedForRadius(r);
  console.log(`${name.padEnd(16)} | ${r.toFixed(3).padStart(6)} | ${tgt.toFixed(2).padStart(6)} | ${vmax.toFixed(3).padStart(6)}`);
}
console.log(`spread: v_min=${vMin.toFixed(3)} v_max=${vMax.toFixed(3)} ratio=${(vMax / vMin).toFixed(2)}x`);

console.log("\n--- hills-01 golden-track finish times (single wheel, seed default) ---");const goldens: Array<[string, [number, number][]]> = [
  ["circ-32-r40 (r=0.4)", circle(0.4, 32)],
  ["circ-32-r20 (r=0.2)", circle(0.2, 32)],
  ["circ-32-r80 (r=0.8)", circle(0.8, 32)],
  ["tri-equi-40 (r=0.4)", regularPolygon(3, 0.4)],
  ["tri-equi (r=0.5)", regularPolygon(3, 0.5)],
  ["square-40 (r=0.4)", regularPolygon(4, 0.4)],
  ["hexa-40 (r=0.4)", regularPolygon(6, 0.4)],
  ["star-5-sharp", star(5, 0.15, 0.45)],
  ["star-5-soft", star(5, 0.3, 0.45)],
];
const MAX_TICKS = 60 * 180;
console.log("wheel                | R_max  | ω tgt  | finishTicks | time_s | finalX");
for (const [name, verts] of goldens) {
  const res = runHeadless({
    wheels: [{ swap_tick: 0, polygon: verts }],
    track: GOLDEN_TRACK,
  });
  const rMax = wheelRadiusOf(verts);
  const tgt = motorSpeedForRadius(rMax);
  const dnf = res.finishTicks >= MAX_TICKS;
  console.log(
    `${name.padEnd(20)} | ${rMax.toFixed(3).padStart(6)} | ${tgt.toFixed(2).padStart(6)} | ` +
    `${String(res.finishTicks).padStart(11)} | ${(res.finishTicks / 60).toFixed(1).padStart(6)} | ` +
    `${res.finalX.toFixed(2)}${dnf ? " DNF" : ""}`
  );
}
