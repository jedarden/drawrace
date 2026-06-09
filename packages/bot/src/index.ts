import { runHeadless, type TrackDef, type WheelSwap } from "@drawrace/engine-core";

// ============================================================================
// Types (plan §13)
// ============================================================================

export type Polygon = [number, number][];

export interface Position {
  x: number;
  y: number;
  tick: number;
}

export interface Ghost {
  wheelVertices: Array<{ x: number; y: number }>;
  finishTimeMs: number;
  seed: number;
  wheels?: Array<{ swap_tick: number; polygon: Polygon }>;
}

export interface BotRun {
  shape: Polygon;
  track: number; // TrackId (numeric)
  seed: number;
}

export interface BotResult {
  finishTicks: number;
  finishMs: number;
  finalX: number;
  dnf: boolean;
  rankDelta: number; // vs provided ghost set
  positionStream: Position[];
}

export interface FuzzResult {
  totalRuns: number;
  dnfCount: number;
  crashCount: number;
  errorCount: number;
  unexpectedDnfs: Array<{ shape: Polygon; track: number; reason: string }>;
}

// ============================================================================
// Track lookup
// ============================================================================

interface TrackRecord {
  id: string;
  numeric_id: number;
  name: string;
  world: { gravity: [number, number]; pixelsPerMeter: number };
  terrain: [number, number][];
  obstacles?: Array<{
    type: string;
    pos: [number, number];
    size?: [number, number];
    radius?: number;
    angle?: number;
    friction?: number;
  }>;
  zones?: Array<{ id: string; x_start: number; x_end: number }>;
  ramps?: Array<{ zone: string; x_start: number; x_end: number }>;
  hazards?: Array<{ zone: string; type: string; x_start: number; x_end: number }>;
  surfaces?: unknown;
  start: { pos: [number, number]; facing: number };
  finish: { pos: [number, number]; width: number };
}

// Track registry - populated at runtime by consuming code
let trackRegistry: Map<number, TrackDef> = new Map();

/**
 * Register tracks for bot simulations. Must be called before runBot/fuzzRun.
 * @param tracks Array of track definitions (typically loaded from JSON files)
 */
export function registerTracks(tracks: TrackRecord[]): void {
  for (const track of tracks) {
    trackRegistry.set(track.numeric_id, track as TrackDef);
  }
}

/**
 * Get a track definition by numeric ID.
 * @throws if track not found
 */
function getTrack(trackId: number): TrackDef {
  const track = trackRegistry.get(trackId);
  if (!track) {
    throw new Error(`Track ${trackId} not registered. Call registerTracks() first.`);
  }
  return track;
}

// ============================================================================
// runBot
// ============================================================================

/**
 * Run a bot simulation with the given shape and optional ghost comparisons.
 * @param r Bot run configuration
 * @param ghosts Optional array of ghost data to compare against
 * @returns BotResult with timing, DNF status, rank delta, and position stream
 */
export async function runBot(r: BotRun, ghosts?: Ghost[]): Promise<BotResult> {
  const { shape, track: trackId, seed } = r;
  const track = getTrack(trackId);

  // Convert polygon to WheelSwap format (swap_tick 0 = initial wheel)
  const wheels: WheelSwap[] = [{ swap_tick: 0, polygon: shape }];

  // Capture position stream during simulation
  const positionStream: Position[] = [];
  let maxTick = 0;

  const onTick = (tick: number, chassisBody: { getPosition: () => { x: number; y: number } }) => {
    const pos = chassisBody.getPosition();
    positionStream.push({ x: pos.x, y: pos.y, tick });
    maxTick = tick;
  };

  // Run simulation
  const result = runHeadless({ track, wheels, seed, onTick });

  // Calculate rank delta vs ghosts
  let rankDelta = 0;
  if (ghosts && ghosts.length > 0) {
    const botFinishMs = result.finishTicks * (1000 / 60); // ticks at 60Hz
    // Count how many ghosts beat this time
    const beatenBy = ghosts.filter(g => g.finishTimeMs < botFinishMs).length;
    rankDelta = ghosts.length - beatenBy; // +rank means ahead of more ghosts
  }

  const finishMs = result.finishTicks * (1000 / 60);

  return {
    finishTicks: result.finishTicks,
    finishMs,
    finalX: result.finalX,
    dnf: result.stuck || result.finishTicks >= 60 * 180, // 3 minute DNF ceiling
    rankDelta,
    positionStream,
  };
}

// ============================================================================
// parametricWheel
// ============================================================================

/**
 * Generate a wheel polygon from parametric description.
 * @param kind Wheel type: "circle", "oval", "star", or "blob"
 * @param params Shape parameters (radius, points, noise, etc.)
 * @returns Polygon as array of [x, y] vertices
 */
export function parametricWheel(
  kind: "circle" | "oval" | "star" | "blob",
  params: Record<string, number>,
): Polygon {
  const { radius = 50, points = 12 } = params;

  switch (kind) {
    case "circle": {
      const verts: Polygon = [];
      for (let i = 0; i < points; i++) {
        const angle = (2 * Math.PI * i) / points;
        verts.push([
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
        ]);
      }
      return verts;
    }

    case "oval": {
      const aspectRatio = params.aspectRatio ?? 1.5;
      const verts: Polygon = [];
      for (let i = 0; i < points; i++) {
        const angle = (2 * Math.PI * i) / points;
        verts.push([
          Math.cos(angle) * radius * aspectRatio,
          Math.sin(angle) * radius,
        ]);
      }
      return verts;
    }

    case "star": {
      const innerRadius = params.innerRadius ?? radius * 0.4;
      const verts: Polygon = [];
      const actualPoints = points * 2; // star has 2x points (outer + inner)
      for (let i = 0; i < actualPoints; i++) {
        const angle = (2 * Math.PI * i) / actualPoints - Math.PI / 2;
        const r = i % 2 === 0 ? radius : innerRadius;
        verts.push([Math.cos(angle) * r, Math.sin(angle) * r]);
      }
      return verts;
    }

    case "blob": {
      // CMA-ML-friendly blob: circle with per-vertex radius noise
      const noise = params.noise ?? 0.3;
      const seed = params.seed ?? 0;
      const verts: Polygon = [];
      for (let i = 0; i < points; i++) {
        const angle = (2 * Math.PI * i) / points;
        // Perlin-like noise using simple pseudo-random
        const noiseOffset = pseudoRandom(seed + i) * noise * radius;
        const r = radius + noiseOffset;
        verts.push([Math.cos(angle) * r, Math.sin(angle) * r]);
      }
      return verts;
    }

    default:
      throw new Error(`Unknown wheel kind: ${kind}`);
  }
}

// Simple deterministic pseudo-random for parametric blob noise
function pseudoRandom(n: number): number {
  // Simple hash-based PRNG (not cryptographically secure, but deterministic)
  const x = Math.sin(n) * 10000;
  return x - Math.floor(x);
}

// ============================================================================
// Fuzz runner
// ============================================================================

/**
 * Fuzz test with random polygons.
 * @param iterations Number of random shapes to test (default 10000)
 * @param trackId Optional track to test (default: all registered tracks)
 * @returns FuzzResult with counts of DNFs, crashes, and errors
 */
export function fuzzRun(
  iterations: number = 10000,
  trackId?: number,
): FuzzResult {
  const tracksToTest = trackId !== undefined
    ? [getTrack(trackId)]
    : Array.from(trackRegistry.values());

  let dnfCount = 0;
  let crashCount = 0;
  let errorCount = 0;
  const unexpectedDnfs: Array<{ shape: Polygon; track: number; reason: string }> = [];

  // Capture console errors
  const originalError = console.error;
  const errors: string[] = [];
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
    originalError(...args);
  };

  try {
    for (let i = 0; i < iterations; i++) {
      const track = tracksToTest[i % tracksToTest.length];
      const seed = Date.now() + i;

      // Generate random blob shape
      const shape = parametricWheel("blob", {
        radius: 30 + Math.random() * 40,
        points: Math.floor(8 + Math.random() * 12), // 8-20 points
        noise: 0.1 + Math.random() * 0.4,
        seed: i,
      });

      try {
        const result = runHeadless({
          track,
          wheels: [{ swap_tick: 0, polygon: shape }],
          seed,
        });

        // Track DNFs (stuck or timeout)
        if (result.stuck || result.finishTicks >= 60 * 180) {
          dnfCount++;
          // Only flag as unexpected if it finished very quickly (likely broken shape)
          if (result.finishTicks < 60) {
            unexpectedDnfs.push({
              shape,
              track: (track as TrackRecord).numeric_id,
              reason: `DNF at tick ${result.finishTicks} (stuck=${result.stuck})`,
            });
          }
        }
      } catch (e) {
        // Crash during simulation
        crashCount++;
        unexpectedDnfs.push({
          shape,
          track: (track as TrackRecord).numeric_id,
          reason: `Crash: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  } finally {
    // Restore console.error
    console.error = originalError;
  }

  // Count console errors
  errorCount = errors.length;

  return {
    totalRuns: iterations,
    dnfCount,
    crashCount,
    errorCount,
    unexpectedDnfs,
  };
}

// ============================================================================
// Version
// ============================================================================

export const BOT_VERSION = "0.0.1";
