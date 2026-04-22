export { PHYSICS_VERSION } from "./version.js";
export { sfc32, hashSeed } from "./prng.js";
export type { PrngState } from "./prng.js";
export { InjectedClock } from "./clock.js";
export type { Clock } from "./clock.js";
export { createHeadlessRace } from "./headless-race.js";
export type {
  TrackDef,
  WheelDef,
  HeadlessRaceInput,
  HeadlessRaceResult,
} from "./headless-race.js";
export { RaceSim, DT } from "./race-sim.js";
export type { RaceSnapshot, SimBody } from "./race-sim.js";
export {
  computeBBox,
  closeLoop,
  simplifyStroke,
  areaCentroid,
  convexDecompose,
  processDraw,
} from "./draw-pipeline.js";
export type { Point, DrawResult } from "./draw-pipeline.js";
