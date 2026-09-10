/**
 * Throwaway probe (drawrace-0238e6da): why does the diagnostic flatTrack stall
 * everything (ω≈0, Vx≈0) by ~tick 120 under radius-compensated motor targets?
 * Prints per-tick diagnostics for a single wheel/track combination.
 *
 * Usage: npx tsx packages/engine-core/scripts/probe-flat-stall.ts [r] [n-ticks]
 */
import { RaceSim } from "../src/race-sim.js";
import * as swap from "../src/swap.js";

function circle(r: number, n: number): [number, number][] {
  const v: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    v.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return v;
}

const r = Number(process.argv[2] ?? "0.8");
const N = Number(process.argv[3] ?? "60");

const flatTrack = {
  id: "diagnostic-flat",
  world: { gravity: [0, 10] as [number, number], pixelsPerMeter: 80 },
  terrain: [
    [-10, 0],
    [100, 0],
  ] as [number, number][],
  zones: [
    { id: "start", x_start: -10, x_end: 0 },
    { id: "race", x_start: 0, x_end: 100 },
  ] as Array<{ id: string; x_start: number; x_end: number }>,
  start: { pos: [0, -2] as [number, number], facing: 0 },
  finish: { pos: [50, 0] as [number, number], width: 10 },
};

const poly = circle(r, 12);
const sim = new RaceSim(flatTrack, poly.map(([x, y]) => ({ x, y })));
sim.enableMotor();

console.log(`12-gon r=${r}  wheelRadiusOf=${swap.wheelRadiusOf(poly).toFixed(4)}  motor target=${swap.motorSpeedForRadius(swap.wheelRadiusOf(poly)).toFixed(2)} rad/s`);
console.log("tick | chassisX | chassisY | chassisAngle | Vx | Vy | frontω | rearω");
for (let i = 0; i < N; i++) {
  sim.step();
  const d = sim.getDiagnosticData();
  if (i < 12 || i % 5 === 0) {
    console.log(
      `${String(i).padStart(4)} | ${d.chassisX.toFixed(3).padStart(8)} | ${d.chassisY.toFixed(3).padStart(8)} | ` +
      `${(sim as unknown as { chassisBody: { getAngle(): number } }).chassisBody?.getAngle().toFixed(3).padStart(8) ?? "   n/a  "} | ` +
      `${d.chassisVelX.toFixed(3).padStart(6)} | ${d.chassisVelY.toFixed(3).padStart(6)} | ` +
      `${d.frontWheelAngVel.toFixed(3).padStart(6)} | ${d.rearWheelAngVel.toFixed(3).padStart(6)}`
    );
  }
}
