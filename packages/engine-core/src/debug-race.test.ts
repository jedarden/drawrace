import { describe, it } from "vitest";
import { RaceSim } from "../packages/engine-core/src/race-sim.js";
import type { TrackDef } from "../packages/engine-core/src/headless-race.js";

const TEST_TRACK: TrackDef = {
  id: "hills-01",
  world: { gravity: [0, 10], pixelsPerMeter: 30 },
  terrain: [[0, 5], [5, 5], [10, 5.3], [15, 5.3], [18, 5.8], [22, 5.8], [25, 5], [30, 5], [35, 5.2], [40, 5.2]],
  start: { pos: [1.5, 3.5], facing: 1 },
  finish: { pos: [39, 3.5], width: 0.2 },
};

function makeCircle(r: number, n: number) {
  const v: Array<{x: number, y: number}> = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    v.push({ x: Math.round(r * Math.cos(a) * 1000) / 1000, y: Math.round(r * Math.sin(a) * 1000) / 1000 });
  }
  return v;
}

describe("debug", () => {
  it("tracks position", () => {
    const sim = new RaceSim(TEST_TRACK, makeCircle(0.8, 16), 42);
    sim.enableMotor();
    for (let i = 0; i < 10800; i++) {
      const snap = sim.step();
      if (i % 500 === 0) console.log("tick", snap.tick, "wheel.x", snap.wheel.x.toFixed(3), "rear.x", snap.rearWheel.x.toFixed(3), "chassis.x", snap.chassis.x.toFixed(3));
      if (snap.finished) { console.log("FINISHED at tick", snap.tick); break; }
    }
    const final = sim.snapshot();
    console.log("final: tick", final.tick, "wheel.x", final.wheel.x.toFixed(3), "finished", final.finished);
  });
});
