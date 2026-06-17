import { RaceSim } from "./race-sim.js";

const flatTrack = {
  id: "diagnostic-flat",
  world: { gravity: [0, 10] as [number, number], pixelsPerMeter: 80 },
  terrain: [[-10, 0], [100, 0]] as [number, number][],
  zones: [{ id: "start", x_start: -10, x_end: 0 }, { id: "race", x_start: 0, x_end: 100 }] as Array<{id:string;x_start:number;x_end:number}>,
  start: { pos: [0, -2] as [number, number], facing: 0 },
  finish: { pos: [50, 0] as [number, number], width: 10 },
};
const wheelTri = [{ x: 0.8, y: 0 }, { x: -0.4, y: 0.693 }, { x: -0.4, y: -0.693 }];

const sim = new RaceSim(flatTrack, wheelTri);
sim.enableMotor();

console.log("Tick | FrontAngVel | RearAngVel  | ChassisVx | ChassisX  | ChassisAngle");
for (let i = 0; i < 30; i++) {
  sim.step();
  const d = sim.getDiagnosticData();
  const _snap = sim.getDiagnosticData();
  // We need to read chassis angle from the snapshot
  // getDiagnosticData() doesn't return chassis angle directly
  // Let's check frontWheelAngle instead
  if (i < 6 || i % 5 === 0)
    console.log(`  ${i.toString().padStart(3)} | ${d.frontWheelAngVel.toFixed(2).padStart(11)} | ${d.rearWheelAngVel.toFixed(2).padStart(11)} | ${d.chassisVelX.toFixed(2).padStart(9)} | ${d.chassisX.toFixed(3).padStart(9)}`);
}
