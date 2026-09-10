/**
 * Per-zone segment-timing harness (drawrace-b379c377, child of the hills-01
 * calibration bead drawrace-d85f702c).
 *
 * Formalizes the previously untracked tune-hills01.ts / sweep-hills01.ts
 * calibration scripts into a committed test utility. Each candidate wheel is
 * run SOLO over a track at a fixed seed and per-zone tick counts are recorded
 * from the actual front-wheel x trace, with zone boundaries taken from
 * track.zones (x_start/x_end). Zone winners derived through this module come
 * from the simulation itself — never from declared factor tables.
 *
 * This module is a test/calibration utility: it is intentionally NOT part of
 * the published package surface (see tsconfig.build.json).
 */
import { runHeadless } from "./headless.js";
import type { HeadlessRaceResult, TrackDef } from "./headless-race.js";
import type { SurfaceType } from "./surface.js";

/** Fixed calibration seed — every timing in this module runs at this seed. */
export const ZONE_TIMING_SEED = 42;

/** Tolerance for boundary/finish comparisons on float positions (meters). */
const EPS = 1e-6;

export type Verts = [number, number][];

/** Regular n-gon centered on the origin. */
export function circle(radius: number, segments: number): Verts {
  const v: Verts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    v.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return v;
}

/** Toothed wheel: `teeth` teeth, each a base-tip-base vertex triple. */
export function gear(teeth: number, rTip: number, rBase: number): Verts {
  const v: Verts = [];
  for (let i = 0; i < teeth; i++) {
    const baseAngle = (i / teeth) * Math.PI * 2;
    for (let j = 0; j < 3; j++) {
      const a = baseAngle + (j / 3) * ((Math.PI * 2) / teeth);
      const r = j === 1 ? rTip : rBase;
      v.push([r * Math.cos(a), r * Math.sin(a)]);
    }
  }
  return v;
}

/**
 * Candidate wheel library for zone calibration. Sizes bracket the engine's
 * clamped radius range; gears represent aggressive toothed shapes.
 */
export const CANDIDATE_WHEELS: Record<string, Verts> = {
  "circle-r35": circle(0.35, 18),
  "circle-r40": circle(0.4, 20),
  "circle-r48": circle(0.48, 22),
  "circle-r50": circle(0.5, 24),
  "circle-r55": circle(0.55, 26),
  "circle-r60": circle(0.6, 28),
  "circle-r65": circle(0.65, 30),
  "gear-16": gear(16, 0.38, 0.25),
  "gear-16-lg": gear(16, 0.6, 0.42),
};

/** Sorted-by-x_start zones; empty when the track declares none. */
export function sortedZones(track: TrackDef): { id: string; x_start: number; x_end: number }[] {
  return [...(track.zones ?? [])].sort((a, b) => a.x_start - b.x_start);
}

export interface TracedRun {
  result: HeadlessRaceResult;
  /** Front-wheel world x after each tick; frontWheelXs[i] is tick i+1. */
  frontWheelXs: number[];
}

/** Run a wheel sequence, tracing the actual front-wheel x each tick. */
export function runTraced(
  track: TrackDef,
  wheelSeq: { swap_tick: number; polygon: Verts }[],
  seed: number = ZONE_TIMING_SEED,
): TracedRun {
  const frontWheelXs: number[] = [];
  const result = runHeadless({
    seed,
    track,
    wheels: wheelSeq,
    onTick: (_tick, _chassis, frontWheel) => {
      frontWheelXs.push(frontWheel.getPosition().x);
    },
  });
  return { result, frontWheelXs };
}

export interface ZoneSplits {
  /** Zone ids in x order (from track.zones). */
  zoneIds: string[];
  /**
   * Simulated ticks consumed per zone, same order as zoneIds. The last zone's
   * segment runs to the finish line, so ticks always sum to totalTicks.
   */
  ticks: number[];
  /** Whether the trace reached the finish line. */
  finished: boolean;
}

/**
 * Per-zone tick counts from a front-wheel x trace. Zone boundaries come from
 * track.zones (each zone's x_end, which validateZones pins to the next zone's
 * x_start); the last zone's segment runs to the finish line, so ticks always
 * sum to totalTicks. A wheel that never crosses a boundary is credited the
 * elapsed ticks it spent in that zone and zero for the zones it never entered.
 */
export function zoneTimes(
  track: TrackDef,
  frontWheelXs: number[],
  totalTicks: number,
): ZoneSplits {
  const zones = sortedZones(track);
  const finished =
    frontWheelXs.length > 0 && frontWheelXs[frontWheelXs.length - 1] >= track.finish.pos[0] - EPS;
  if (zones.length === 0) {
    // Unzoned track: the whole run is one implicit segment.
    return { zoneIds: [], ticks: [totalTicks], finished };
  }
  const bounds = zones.slice(0, -1).map((z) => z.x_end);
  const ticks: number[] = [];
  let prev = 0;
  for (let i = 0; i < zones.length; i++) {
    if (i === zones.length - 1) {
      ticks.push(totalTicks - prev);
      break;
    }
    const idx = frontWheelXs.findIndex((x) => x >= bounds[i] - EPS);
    if (idx === -1) {
      // Boundary never crossed: this zone took the rest of the run, the
      // zones beyond it were never entered.
      ticks.push(totalTicks - prev);
      while (ticks.length < zones.length) ticks.push(0);
      break;
    }
    ticks.push(idx + 1 - prev);
    prev = idx + 1;
  }
  return {
    zoneIds: zones.map((z) => z.id),
    ticks,
    finished,
  };
}

export interface ZoneTiming {
  name: string;
  zoneIds: string[];
  /** Simulated ticks consumed per zone (see zoneTimes). */
  ticks: number[];
  totalTicks: number;
  finished: boolean;
  finalX: number;
  stuck: boolean;
}

/** Run one wheel solo over the track and time its per-zone segments. */
export function runSingle(
  track: TrackDef,
  name: string,
  verts: Verts,
  seed: number = ZONE_TIMING_SEED,
): ZoneTiming {
  const { result, frontWheelXs } = runTraced(track, [{ swap_tick: 0, polygon: verts }], seed);
  const { zoneIds, ticks } = zoneTimes(track, frontWheelXs, result.finishTicks);
  // Finish is judged exactly as runHeadless judges it: front wheel x at the line.
  return {
    name,
    zoneIds,
    ticks,
    totalTicks: result.finishTicks,
    finished: result.finalX >= track.finish.pos[0] - EPS,
    finalX: result.finalX,
    stuck: result.stuck,
  };
}

/** Run every candidate wheel solo over the track at the fixed seed. */
export function runAllCandidates(
  track: TrackDef,
  seed: number = ZONE_TIMING_SEED,
): ZoneTiming[] {
  return Object.entries(CANDIDATE_WHEELS).map(([name, verts]) => runSingle(track, name, verts, seed));
}

export interface ZoneWinner {
  zoneId: string;
  /** Winning wheel name, or null when no wheel measured the zone. */
  wheel: string | null;
  /** Winning segment time in ticks; Infinity when unmeasured. */
  ticks: number;
}

/**
 * Per-zone winners: lowest simulated segment tick count per zone. Wheels that
 * did not finish the track are excluded from ranking — their unreached zones
 * were never measured — unless no wheel finished, in which case every wheel
 * ranks on the segments it did reach.
 */
export function zoneWinners(singles: ZoneTiming[]): ZoneWinner[] {
  const zoneIds = singles[0]?.zoneIds ?? [];
  const finishers = singles.filter((s) => s.finished);
  const pool = finishers.length > 0 ? finishers : singles;
  return zoneIds.map((zoneId, i) => {
    const best = [...pool].sort((a, b) => a.ticks[i] - b.ticks[i])[0];
    return { zoneId, wheel: best?.name ?? null, ticks: best ? best.ticks[i] : Infinity };
  });
}

/**
 * Build a track copy whose surfaces[] is one segment per zone, from specs
 * like "snow" (whole zone), "water:normal" (split at the zone midpoint) or
 * "water:32:normal" (split at explicit x). Lets calibration sweep surface
 * assignments without hand-editing track JSON.
 */
export function trackWithSurfaces(track: TrackDef, zoneSurface: string[]): TrackDef {
  const zones = sortedZones(track);
  if (zones.length === 0) {
    throw new Error("trackWithSurfaces requires a zoned track");
  }
  if (zoneSurface.length !== zones.length) {
    throw new Error(`expected ${zones.length} zone surface specs, got ${zoneSurface.length}`);
  }
  const terrainMaxX = track.terrain[track.terrain.length - 1][0];
  const out: TrackDef = JSON.parse(JSON.stringify(track));
  const segments: { x_range: [number, number]; type: SurfaceType }[] = [];
  zoneSurface.forEach((spec, i) => {
    const x0 = zones[i].x_start;
    const x1 = i < zones.length - 1 ? zones[i + 1].x_start : terrainMaxX;
    const parts = spec.split(":");
    if (parts.length === 1) {
      segments.push({ x_range: [x0, x1], type: parts[0] as SurfaceType });
    } else {
      // "a:b" splits at the zone midpoint; "a:x:b" splits at explicit x
      const mid = parts.length === 3 ? parseFloat(parts[1]) : (x0 + x1) / 2;
      segments.push({ x_range: [x0, mid], type: parts[0] as SurfaceType });
      segments.push({ x_range: [mid, x1], type: parts[parts.length - 1] as SurfaceType });
    }
  });
  out.surfaces = segments;
  return out;
}
