/**
 * Parametric calibration harness for hills-01 (drawrace-8d3baef5).
 *
 * Sweeps terrain shape × surface assignment × wheel-surface interaction
 * constants and reports, per config, the timing-derived zone winners for the
 * candidate wheel library with margins — against the declared targets
 * A=circle-r35, B=gear-16, C=circle-r65, D=circle-r48.
 *
 * Run: npx tsx packages/engine-core/scripts/calibrate-hills01.ts [name ...]
 * No arguments runs every CONFIG entry.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { runHeadless } from "../src/headless.js";
import { SURFACE_PRESETS, PLOW_TUNING, type SurfacePreset, type SurfaceType } from "../src/surface.js";
import { MOTOR_TORQUE_TUNING } from "../src/swap.js";
import {
  CANDIDATE_WHEELS,
  ZONE_TIMING_SEED,
  type Verts,
} from "../src/zone-timing.js";
import type { TrackDef } from "../src/headless-race.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_TRACK: TrackDef = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "..", "apps", "web", "public", "tracks", "hills-01.json"), "utf-8"),
);

/** Declared zone-optimal wheel per zone (the calibration target). */
export const DECLARED: Record<string, string> = {
  A: "circle-r35",
  B: "gear-16",
  C: "circle-r65",
  D: "circle-r48",
};

export interface TerrainOpts {
  /** Zone A oscillation amplitude (m). 0 = dead flat. */
  aAmp: number;
  /** Zone B plateau height (m): climb 8→15, plateau 15→18. */
  bTop: number;
  /** Zone C bump amplitude (m) around bTop. */
  cAmp: number;
  /** Zone D water shelf height (m), 28→34. */
  dShelf: number;
  /** Zone D final plateau height (m): climb 34→38, plateau 38→40. */
  dTop: number;
  /** Zone A terrain sample step (m). 1 = the coarse default whose 1 m facets
   * dip under small wheels; 0.25 smooths the facet noise away. */
  aStep?: number;
}

export function buildTerrain(o: TerrainOpts): [number, number][] {
  const t: [number, number][] = [];
  // Zone A: gentle oscillation on the flat (non-integer phase so integer
  // samples actually vary). aStep < 1 densifies the polyline so small wheels
  // stop losing energy in the facet valleys (drawrace-8d3baef5 zone A).
  const step = o.aStep ?? 1;
  for (let x = 0; x <= 8; x += step) {
    t.push([Math.round(x * 1000) / 1000, Math.round(o.aAmp * Math.sin(x * 1.7) * 1000) / 1000]);
  }
  if (t[t.length - 1][0] < 8 - 1e-9) t.push([8, Math.round(o.aAmp * Math.sin(8 * 1.7) * 1000) / 1000]);
  // Zone B: climb 8→15 to bTop, plateau 15→18
  for (let x = 9; x <= 15; x++) t.push([x, Math.round((o.bTop * (x - 8)) / 7 * 1000) / 1000]);
  t.push([16, o.bTop], [17, o.bTop], [18, o.bTop]);
  // Zone C: bumpy plateau 19→28
  for (let x = 19; x <= 28; x++) {
    const bump = (x % 2 === 0 ? -1 : 1) * o.cAmp;
    t.push([x, Math.round((o.bTop + bump) * 1000) / 1000]);
  }
  // Zone D: water shelf 29→34, climb 35→38 to dTop, plateau 39→40
  t.push([29, o.dShelf], [30, o.dShelf], [31, o.dShelf], [32, o.dShelf], [33, o.dShelf], [34, o.dShelf]);
  for (let x = 35; x <= 38; x++) {
    t.push([x, Math.round((o.dShelf + ((o.dTop - o.dShelf) * (x - 34)) / 4) * 1000) / 1000]);
  }
  t.push([39, o.dTop], [40, o.dTop]);
  return t;
}

export interface SurfaceSpec {
  /** Zone surface specs ("snow", "ice:15:snow", ...) applied over zones A..D. */
  zones: string[];
}

export function applyZoneSurfaces(track: TrackDef, specs: string[]): TrackDef {
  const zones = [...(track.zones ?? [])].sort((a, b) => a.x_start - b.x_start);
  const maxX = track.terrain[track.terrain.length - 1][0];
  const out: TrackDef = JSON.parse(JSON.stringify(track));
  const segs: { x_range: [number, number]; type: SurfaceType }[] = [];
  specs.forEach((spec, i) => {
    const x0 = zones[i].x_start;
    const x1 = i < zones.length - 1 ? zones[i + 1].x_start : maxX;
    const parts = spec.split(":");
    if (parts.length === 1) {
      segs.push({ x_range: [x0, x1], type: parts[0] as SurfaceType });
    } else {
      const mid = parts.length === 3 ? parseFloat(parts[1]) : (x0 + x1) / 2;
      segs.push({ x_range: [x0, mid], type: parts[0] as SurfaceType });
      segs.push({ x_range: [mid, x1], type: parts[parts.length - 1] as SurfaceType });
    }
  });
  out.surfaces = segs;
  return out;
}

export interface PhysOverrides {
  sinkage?: Partial<Record<SurfaceType, number>>;
  /** Full preset field overrides, applied after `sinkage` shorthand. */
  presets?: Partial<Record<SurfaceType, Partial<SurfacePreset>>>;
  /** Plow drag exponent (PLOW_TUNING.exponent) — how sharply a fluid preset
   * resolves adjacent candidate radii around its optimum. */
  plowExponent?: number;
  /** Motor torque exponent (MOTOR_TORQUE_TUNING.exponent) — how strongly
   * launch torque favors small wheels (drawrace-8d3baef5 zone A). */
  torqueExponent?: number;
  /** Extra x boundaries for diagnostic sub-splits (e.g. [15, 34]). */
  splits?: number[];
}

/** Terrain height at `x` by linear interpolation over a polyline. */
function terrainYAt(terrain: [number, number][], x: number): number {
  for (let i = 0; i < terrain.length - 1; i++) {
    if (terrain[i][0] <= x && x <= terrain[i + 1][0]) {
      const t = (x - terrain[i][0]) / (terrain[i + 1][0] - terrain[i][0]);
      return terrain[i][1] + t * (terrain[i + 1][1] - terrain[i][1]);
    }
  }
  return terrain[x <= terrain[0][0] ? 0 : terrain.length - 1][1];
}

export interface Config {
  name: string;
  terrain: TerrainOpts;
  surfaces: string[];
  phys?: PhysOverrides;
}

/** Extra diagnostic split boundaries (default: B plateau at 15, D water end at 34). */
const DEFAULT_SPLITS = [15, 34];

export interface RunResult {
  name: string;
  /** Front-wheel x at every tick (index i = tick i+1). */
  xs: number[];
  finishTicks: number;
  finished: boolean;
  finalX: number;
  stuck: boolean;
}

/** Per-interval tick counts from an x trace against ascending boundaries. */
export function intervalTicks(xs: number[], bounds: number[], finishTicks: number): number[] {
  const ticks: number[] = [];
  let prev = 0;
  for (const b of bounds) {
    let idx = xs.findIndex((x) => x >= b - 1e-6);
    if (idx === -1) idx = xs.length;
    ticks.push(idx + 1 - prev);
    prev = idx + 1;
  }
  ticks.push(finishTicks - prev);
  return ticks;
}

export function runConfig(cfg: Config): RunResult[] {
  const saved: Partial<Record<SurfaceType, SurfacePreset>> = {};
  const savePreset = (t: SurfaceType): void => {
    if (!(t in saved)) saved[t] = { ...SURFACE_PRESETS[t] };
  };
  const savedPlowExponent = PLOW_TUNING.exponent;
  const savedTorqueExponent = MOTOR_TORQUE_TUNING.exponent;
  if (cfg.phys?.sinkage) {
    for (const [k, v] of Object.entries(cfg.phys.sinkage)) {
      const t = k as SurfaceType;
      savePreset(t);
      SURFACE_PRESETS[t].sinkage = v as number;
    }
  }
  if (cfg.phys?.presets) {
    for (const [k, patch] of Object.entries(cfg.phys.presets)) {
      const t = k as SurfaceType;
      savePreset(t);
      Object.assign(SURFACE_PRESETS[t], patch);
    }
  }
  if (cfg.phys?.plowExponent !== undefined) PLOW_TUNING.exponent = cfg.phys.plowExponent;
  if (cfg.phys?.torqueExponent !== undefined) MOTOR_TORQUE_TUNING.exponent = cfg.phys.torqueExponent;
  try {
    const track = applyZoneSurfaces(RAW_TRACK, cfg.surfaces);
    track.terrain = buildTerrain(cfg.terrain);
    // Keep zone-C obstacles resting on the (possibly re-shaped) terrain: carry
    // each obstacle's original height ABOVE the raw terrain to the new shape.
    if (track.obstacles) {
      for (const obs of track.obstacles) {
        const ox = obs.pos[0];
        const rawY = terrainYAt(RAW_TRACK.terrain, ox);
        obs.pos[1] = Math.round((terrainYAt(track.terrain, ox) + (obs.pos[1] - rawY)) * 1000) / 1000;
      }
    }
    return Object.entries(CANDIDATE_WHEELS).map(([name, verts]) => {
      const xs: number[] = [];
      const r = runHeadless({
        seed: ZONE_TIMING_SEED,
        track,
        wheels: [{ swap_tick: 0, polygon: verts as Verts }],
        onTick: (_t, _c, fw) => xs.push(fw.getPosition().x),
      });
      return {
        name,
        xs,
        finishTicks: r.finishTicks,
        finished: r.finalX >= track.finish.pos[0] - 1e-6,
        finalX: r.finalX,
        stuck: r.stuck,
      };
    });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      Object.assign(SURFACE_PRESETS[k as SurfaceType], v);
    }
    PLOW_TUNING.exponent = savedPlowExponent;
    MOTOR_TORQUE_TUNING.exponent = savedTorqueExponent;
  }
}

const TARGET = 0.05; // "meaningful margin": winner ≥5% under runner-up

export function evaluate(cfg: Config, singles: RunResult[]): void {
  console.log(`\n=== ${cfg.name} ===  surfaces=${cfg.surfaces.join(",")}`);
  console.log(`terrain=${JSON.stringify(cfg.terrain)}`);
  if (cfg.phys?.sinkage) console.log(`sinkage=${JSON.stringify(cfg.phys.sinkage)}`);
  if (cfg.phys?.presets) console.log(`presets=${JSON.stringify(cfg.phys.presets)}`);
  if (cfg.phys?.plowExponent !== undefined) console.log(`plowExponent=${cfg.phys.plowExponent}`);
  if (cfg.phys?.torqueExponent !== undefined) console.log(`torqueExponent=${cfg.phys.torqueExponent}`);

  const zones = [...(RAW_TRACK.zones ?? [])].sort((a, b) => a.x_start - b.x_start);
  const zoneBounds = zones.slice(0, -1).map((z) => z.x_end); // opens B, C, D
  const zoneIds = zones.map((z) => z.id);
  const diagLabels = ["A", "B:8-15", "B:15-18", "C", "D:28-34", "D:34-40"];

  const rows = singles.map((s) => ({
    ...s,
    zoneTicks: intervalTicks(s.xs, zoneBounds, s.finishTicks),
    diagTicks: intervalTicks(s.xs, [8, 15, 18, 28, 34], s.finishTicks),
  }));

  const width = Math.max(...rows.map((r) => r.name.length));
  console.log("wheel".padEnd(width) + " | " + diagLabels.map((z) => z.padStart(7)).join(" ") + " | total  result");
  for (const r of rows) {
    console.log(
      r.name.padEnd(width), "|",
      r.diagTicks.map((t) => String(t).padStart(7)).join(" "),
      `| ${String(r.finishTicks).padStart(5)}`,
      r.finished ? (r.stuck ? "STUCK-finish" : "") : `DNF x=${r.finalX.toFixed(2)} stuck=${r.stuck}`,
    );
  }

  const allFinished = singles.every((s) => s.finished);
  const lines: string[] = [];
  let pass = allFinished;
  for (let i = 0; i < zoneIds.length; i++) {
    // Only finishers may hold a zone win: a DNF row's interval count is the
    // ticks it managed before stalling, and ranking it as a "fast" winner
    // would reward exactly the runs the calibration must eliminate.
    const ranked = rows.filter((r) => r.finished).sort((a, b) => a.zoneTicks[i] - b.zoneTicks[i]);
    if (ranked.length < 2) {
      lines.push(`${zoneIds[i]}=unranked(<2 finishers)`);
      pass = false;
      continue;
    }
    const win = ranked[0];
    const margin = ((ranked[1].zoneTicks[i] - win.zoneTicks[i]) / win.zoneTicks[i]) * 100;
    const ok = win.name === DECLARED[zoneIds[i]] && margin >= TARGET;
    if (!ok) pass = false;
    lines.push(
      `${zoneIds[i]}=${win.name}(${win.zoneTicks[i]}t, +${margin.toFixed(1)}% vs ${ranked[1].name})` +
      `${ok ? "" : " ✗want=" + DECLARED[zoneIds[i]]}`,
    );
  }
  console.log(allFinished ? "all finish ✓" : "⚠ NOT ALL FINISH");
  console.log("zone winners (intervalTicks over zone bounds only): " + lines.join("  "));
  console.log(pass ? "PASS" : "fail");
}

const CONFIGS: Config[] = [
  {
    name: "baseline-current",
    terrain: { aAmp: 0.15, bTop: 4.3, cAmp: 0.3, dShelf: 4.2, dTop: 6.4 },
    surfaces: ["normal", "snow:snow", "snow", "water:normal"],
  },
  // One lever at a time, then combinations.
  {
    name: "flatA",
    terrain: { aAmp: 0, bTop: 4.3, cAmp: 0.3, dShelf: 4.2, dTop: 6.4 },
    surfaces: ["normal", "snow:snow", "snow", "water:normal"],
  },
  {
    name: "steepB",
    terrain: { aAmp: 0.15, bTop: 5.5, cAmp: 0.15, dShelf: 5.3, dTop: 6.4 },
    surfaces: ["normal", "snow:snow", "snow", "water:normal"],
  },
  {
    name: "rockC",
    terrain: { aAmp: 0.15, bTop: 4.3, cAmp: 0.3, dShelf: 4.2, dTop: 6.4 },
    surfaces: ["normal", "snow:snow", "rock", "water:normal"],
  },
  {
    name: "waterLow",
    terrain: { aAmp: 0.15, bTop: 4.3, cAmp: 0.3, dShelf: 4.2, dTop: 6.4 },
    surfaces: ["normal", "snow:snow", "snow", "water:normal"],
    phys: { sinkage: { water: 1.0 } },
  },
  {
    name: "combo-1",
    terrain: { aAmp: 0, bTop: 5.5, cAmp: 0.15, dShelf: 5.3, dTop: 6.4 },
    surfaces: ["normal", "snow:snow", "rock", "water:normal"],
    phys: { sinkage: { water: 1.2 } },
  },
  {
    name: "combo-2",
    terrain: { aAmp: 0.05, bTop: 6.0, cAmp: 0.2, dShelf: 5.8, dTop: 6.4 },
    surfaces: ["normal", "snow:snow", "rock", "water:normal"],
    phys: { sinkage: { water: 1.5, snow: 1.5 } },
  },
  // ── Battery v2 (drawrace-8d3baef5, this strand): one lever at a time on the
  // declared-wheel problem. Baseline ties everywhere because every zone rewards
  // exactly one physical axis; each config below isolates one axis.
  {
    // Zone A lever: launch torque ∝ (0.5/r)² — small wheels spin up faster.
    name: "tq2",
    terrain: { aAmp: 0.15, bTop: 4.3, cAmp: 0.3, dShelf: 4.2, dTop: 6.4 },
    surfaces: ["normal", "snow:snow", "snow", "water:normal"],
    phys: { torqueExponent: 2 },
  },
  {
    // Zone A lever 2: dense 0.25 m terrain sampling kills the 1 m facet
    // valleys small wheels lose energy in; combined with tq2.
    name: "tq2-smoothA",
    terrain: { aAmp: 0.15, bTop: 4.3, cAmp: 0.3, dShelf: 4.2, dTop: 6.4, aStep: 0.25 },
    surfaces: ["normal", "snow:snow", "snow", "water:normal"],
    phys: { torqueExponent: 2 },
  },
  {
    // Zone B lever: ice has NO sinkage and interlock 4 — pure tooth grip on
    // the climb. Watch gear-16 for traction-limited DNF (μ 0.1·1.82 = 0.18).
    name: "iceB",
    terrain: { aAmp: 0.15, bTop: 4.3, cAmp: 0.3, dShelf: 4.2, dTop: 6.4 },
    surfaces: ["normal", "ice", "snow", "water:normal"],
  },
  {
    // Zone B lever 2: keep snow (interlock 3) but kill its sinkage, which is
    // what currently taxes the gear (small rolling radius) out of the win.
    name: "snowB-lowsink",
    terrain: { aAmp: 0.15, bTop: 4.3, cAmp: 0.3, dShelf: 4.2, dTop: 6.4 },
    surfaces: ["normal", "snow:snow", "snow", "water:normal"],
    phys: { sinkage: { snow: 0.5 } },
  },
  {
    // Zone C lever: mud sinkage 5.0 is the strongest big-wheel lever in the
    // vocabulary — r35 pays (0.5/0.35)²≈2× while r65 pays 0.59×.
    name: "mudC",
    terrain: { aAmp: 0.15, bTop: 4.3, cAmp: 0.3, dShelf: 4.2, dTop: 6.4 },
    surfaces: ["normal", "snow:snow", "mud", "water:normal"],
  },
  {
    // Zone D lever: rebalance water sinkage/plow to s/p = 1.22 so the drag
    // minimum sits at r ≈ 0.48 (r⁵ = s/(48p)), scaled up to sharpen the
    // relative spread across neighbouring radii.
    name: "waterSharp",
    terrain: { aAmp: 0.15, bTop: 4.3, cAmp: 0.3, dShelf: 4.2, dTop: 6.4 },
    surfaces: ["normal", "snow:snow", "snow", "water:normal"],
    phys: { presets: { water: { sinkage: 4.9, plow: 4.0 } } },
  },
];

function main(): void {
  const want = process.argv.slice(2);
  for (const cfg of CONFIGS) {
    if (want.length > 0 && !want.includes(cfg.name)) continue;
    evaluate(cfg, runConfig(cfg));
  }
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) main();
