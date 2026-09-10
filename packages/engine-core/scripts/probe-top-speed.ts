/**
 * Throwaway probe (drawrace-0238e6da): does the r=0.8 wheel ever reach its
 * compensated motor target on the top-speed flat track, and does the island
 * fall asleep (ω and Vx both pinned at 0 despite an active motor)?
 *
 * Usage: npx tsx packages/engine-core/scripts/probe-top-speed.ts [radius] [sides] [ticks]
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
const sides = Number(process.argv[3] ?? "32");
const N = Number(process.argv[4] ?? "300");

const TOP_TRACK = {
  id: "flat-top-speed",
  world: { gravity: [0, 10] as [number, number], pixelsPerMeter: 30 },
  terrain: [[0, 5], [200, 5]] as [number, number][],
  zones: [{ id: "A", x_start: 0, x_end: 200 }] as Array<{ id: string; x_start: number; x_end: number }>,
  start: { pos: [1.5, 3.5] as [number, number], facing: 1 },
  finish: { pos: [195, 3.5] as [number, number], width: 0.2 },
};

const poly = circle(r, sides);
const sim = new RaceSim(TOP_TRACK, poly.map(([x, y]) => ({ x, y })));
sim.enableMotor();

const target = swap.motorSpeedForRadius(swap.wheelRadiusOf(poly));
console.log(`${sides}-gon r=${r}  R=${swap.wheelRadiusOf(poly).toFixed(4)}  ω target=${target.toFixed(2)}  (linear target ${(target * swap.wheelRadiusOf(poly)).toFixed(2)} m/s)`);
console.log("tick | chassisX |    Vx    | frontω | rearω");
let vmax = 0;
let wmax = 0;
for (let i = 0; i < N; i++) {
  sim.step();
  const d = sim.getDiagnosticData();
  vmax = Math.max(vmax, Math.abs(d.chassisVelX));
  wmax = Math.max(wmax, Math.abs(d.frontWheelAngVel));
  if (i < 10 || i % 15 === 0 || i === N - 1) {
    console.log(
      `${String(i).padStart(4)} | ${d.chassisX.toFixed(3).padStart(8)} | ${d.chassisVelX.toFixed(3).padStart(8)} | ` +
      `${d.frontWheelAngVel.toFixed(3).padStart(6)} | ${d.rearWheelAngVel.toFixed(3).padStart(6)}`
    );
  }
}
console.log(`max|Vx|=${vmax.toFixed(3)}  max|ω|=${wmax.toFixed(3)}  (target ω=${target.toFixed(2)})`);
