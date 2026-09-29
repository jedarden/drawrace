import { Vec2 } from "planck";
import type { Body, Contact } from "planck";

export type SurfaceType = "normal" | "ice" | "snow" | "water" | "mud" | "rock";

export const SURFACE_TYPES: readonly SurfaceType[] = [
  "normal", "ice", "snow", "water", "mud", "rock",
] as const;

export interface SurfacePreset {
  friction: number;
  restitution: number;
  drag: number;
  /**
   * Per-wheel sinkage coefficient for the radius-scaled soft-surface drag
   * (drawrace-8d3baef5). Non-zero adds a velocity-proportional drag force on
   * EACH wheel body of sinkage·(SINKAGE_TUNING.refRadius/r)^SINKAGE_TUNING.exponent
   * — small wheels sink deeper and pay more. 0 = off.
   */
  sinkage: number;
  /**
   * Per-wheel fluid-displacement ("plow") coefficient (drawrace-8d3baef5).
   * Non-zero adds plow·(r/SINKAGE_TUNING.refRadius)^PLOW_TUNING.exponent per
   * wheel — a drag that GROWS with radius. Combined with `sinkage` the total
   * per-wheel soft drag D(r) = s·(ref/r)² + p·(r/ref)³ therefore has a minimum
   * at r*⁵ = s·ref⁵·(2/3)/p — with the default ref = 0.5 that is the compact
   * calibration rule r*⁵ = s/(48p): a track pins the drag minimum on whatever
   * wheel it wants to favor by choosing s/p = 48·r*⁵. 0 = off.
   */
  plow: number;
  /**
   * Tooth-terrain interlock strength (drawrace-8d3baef5). Non-zero multiplies
   * the contact friction of any WHEEL whose shape has protrusions beyond its
   * rolling circle (toothiness = maxExtent/rollingRadius > 1) by
   * 1 + interlock·(toothiness − 1) — teeth dig in and grip where circles
   * slide. Chassis and obstacles are never registered wheels, so they are
   * unaffected. 0 = off.
   */
  interlock: number;
}

// Extreme surface values to force wheel differentiation. The per-wheel
// interaction coefficients (sinkage/plow/interlock) all default to 0: the
// laws exist engine-wide but a surface only exerts them when a track opts in
// through TrackDef.tuning.surfaceInteractions (only hills-01 does today).
export const SURFACE_PRESETS: Record<SurfaceType, SurfacePreset> = {
  normal: { friction: 0.9,  restitution: 0.0,  drag: 0,    sinkage: 0, plow: 0, interlock: 0 },
  ice:    { friction: 0.1,  restitution: 0.0,  drag: 0,    sinkage: 0, plow: 0, interlock: 0 },   // Extremely slippery - teeth essential
  snow:   { friction: 0.4,  restitution: 0.0,  drag: 1.5,  sinkage: 0, plow: 0, interlock: 0 }, // Moderate drag - large wheels favored
  water:  { friction: 0.05, restitution: 0.0,  drag: 3.0,  sinkage: 0, plow: 0, interlock: 0 }, // Heavy drag - compact wheels favored
  mud:    { friction: 0.5,  restitution: 0.0,  drag: 12.0, sinkage: 0, plow: 0, interlock: 0 },// Very heavy drag - small wheels essential
  rock:   { friction: 0.95, restitution: 0.25, drag: 0,    sinkage: 0, plow: 0, interlock: 0 },
};

/**
 * Radius laws for the per-wheel soft-surface interaction drag
 * (drawrace-8d3baef5). Calibration scripts may mutate `exponent` to sweep the
 * laws; landed tracks tune only the per-surface COEFFICIENTS.
 */
export const SINKAGE_TUNING = { refRadius: 0.5, exponent: 2 };
export const PLOW_TUNING = { exponent: 3 };

/** Per-track per-surface coefficient overrides (TrackDef.tuning.surfaceInteractions). */
export type SurfaceInteractionOverrides = Partial<
  Record<SurfaceType, Partial<Pick<SurfacePreset, "sinkage" | "plow" | "interlock">>>
>;

export interface SurfaceSegment {
  x_range: [number, number];
  type: SurfaceType;
  /**
   * The preset this segment resolves to, baked at parse time from
   * SURFACE_PRESETS[type] plus any TrackDef.tuning.surfaceInteractions
   * overrides. Optional: segments constructed outside parseSurfaces (test
   * helpers, calibration scripts) fall back to the global preset.
   */
  preset?: SurfacePreset;
}

const VALID_SURFACE_SET = new Set<string>(SURFACE_TYPES);

export function isValidSurfaceType(type: string): type is SurfaceType {
  return VALID_SURFACE_SET.has(type);
}

export function parseSurfaces(
  raw: unknown,
  terrainMinX: number,
  terrainMaxX: number,
  interactions?: SurfaceInteractionOverrides,
): SurfaceSegment[] {
  if (!raw || !Array.isArray(raw) || raw.length === 0) {
    return [{ x_range: [terrainMinX, terrainMaxX], type: "normal" }];
  }

  const segments: SurfaceSegment[] = [];

  for (let i = 0; i < raw.length; i++) {
    const seg = raw[i];
    if (
      !seg || typeof seg !== "object" || Array.isArray(seg) ||
      !Array.isArray((seg as Record<string, unknown>).x_range) ||
      typeof (seg as Record<string, unknown>).type !== "string"
    ) {
      throw new Error(`Invalid surface segment at index ${i}: ${JSON.stringify(seg)}`);
    }
    const s = seg as { x_range: unknown[]; type: string };
    if (s.x_range.length !== 2 || typeof s.x_range[0] !== "number" || typeof s.x_range[1] !== "number") {
      throw new Error(`Invalid x_range in surface segment at index ${i}`);
    }
    if (!isValidSurfaceType(s.type)) {
      throw new Error(`Unknown surface type "${s.type}" in segment at index ${i}`);
    }
    segments.push({
      x_range: [s.x_range[0], s.x_range[1]],
      type: s.type,
      preset: {
        ...SURFACE_PRESETS[s.type],
        ...interactions?.[s.type],
      },
    });
  }

  segments.sort((a, b) => a.x_range[0] - b.x_range[0]);

  let prevEnd = terrainMinX;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (Math.abs(seg.x_range[0] - prevEnd) > 1e-6) {
      throw new Error(
        `Surface gap or overlap at x=${prevEnd}: segment ${i} starts at ${seg.x_range[0]}`,
      );
    }
    prevEnd = seg.x_range[1];
  }
  if (Math.abs(prevEnd - terrainMaxX) > 1e-6) {
    throw new Error(
      `Surface coverage gap: last segment ends at ${prevEnd}, terrain ends at ${terrainMaxX}`,
    );
  }

  return segments;
}

export function lookupSurface(x: number, surfaces: SurfaceSegment[]): SurfacePreset {
  let lo = 0;
  let hi = surfaces.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = surfaces[mid];
    if (x < seg.x_range[0]) {
      hi = mid - 1;
    } else if (x > seg.x_range[1]) {
      lo = mid + 1;
    } else {
      return seg.preset ?? SURFACE_PRESETS[seg.type];
    }
  }
  return SURFACE_PRESETS.normal;
}

export function applyDrag(chassisBody: Body, surfaces: SurfaceSegment[]): void {
  const cx = chassisBody.getPosition().x;
  const preset = lookupSurface(cx, surfaces);
  if (preset.drag > 0) {
    const vel = chassisBody.getLinearVelocity();
    chassisBody.applyForceToCenter(
      Vec2(-preset.drag * vel.x, -preset.drag * vel.y),
    );
  }
}

/**
 * Per-wheel soft-surface interaction drag (drawrace-8d3baef5).
 *
 * D(r) = sinkage·(ref/r)^SINKAGE_TUNING.exponent + plow·(r/ref)^PLOW_TUNING.exponent,
 * applied as a velocity-proportional force on the wheel body itself — the
 * chassis-wide `applyDrag` above is wheel-independent and cannot separate
 * wheels by radius. With the default exponents the drag minimum sits at
 * r*⁵ = sinkage/(48·plow), so a track pins the favored radius via the s/p
 * ratio. No-op (zero force, exact legacy behavior) on segments whose resolved
 * preset has no sinkage and no plow.
 */
export function applyWheelInteractionDrag(
  wheelBody: Body,
  rollingRadius: number,
  surfaces: SurfaceSegment[],
): void {
  const preset = lookupSurface(wheelBody.getPosition().x, surfaces);
  const sinkage = preset.sinkage;
  const plow = preset.plow;
  if (sinkage === 0 && plow === 0) return;
  const r = Math.max(rollingRadius, 0.05);
  const drag =
    sinkage * Math.pow(SINKAGE_TUNING.refRadius / r, SINKAGE_TUNING.exponent) +
    plow * Math.pow(r / SINKAGE_TUNING.refRadius, PLOW_TUNING.exponent);
  if (drag <= 0) return;
  const vel = wheelBody.getLinearVelocity();
  wheelBody.applyForceToCenter(Vec2(-drag * vel.x, -drag * vel.y));
}

/**
 * Shape registry for the tooth-terrain interlock law: toothiness = boundary
 * excess, ≥ 1, scale-invariant — perimeter / (2π·maxExtent), i.e. how much
 * edge length the shape packs inside the circle its features reach. Circles
 * are exactly 1; toothed/spiky polygons exceed 1 by how much biting edge they
 * carry (gear-16 = 1.82). NOTE the deliberate contrast with wheelRadiusOf:
 * a gear's perimeter/2π ROLLING radius (distance per rotation) sits far
 * OUTSIDE its physical extent, so extent/rolling would report gears as
 * smoother than circles and silence the interlock law entirely.
 * buildWheelBody registers every wheel it creates; anything unregistered
 * (chassis, obstacles) reads as 1 — no interlock.
 */
const wheelToothiness = new WeakMap<object, number>();

/** Register a wheel body's toothiness (called by buildWheelBody). */
export function registerWheelToothiness(body: object, polygon: [number, number][]): void {
  const verts =
    polygon.length > 1 &&
    Math.hypot(polygon[0][0] - polygon[polygon.length - 1][0], polygon[0][1] - polygon[polygon.length - 1][1]) < 1e-6
      ? polygon.slice(0, -1)
      : polygon;
  const cx = verts.reduce((s, q) => s + q[0], 0) / verts.length;
  const cy = verts.reduce((s, q) => s + q[1], 0) / verts.length;
  let perimeter = 0;
  let maxExtent = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
    maxExtent = Math.max(maxExtent, Math.hypot(a[0] - cx, a[1] - cy));
  }
  wheelToothiness.set(body, Math.max(1, perimeter / (2 * Math.PI * maxExtent)));
}

/** Toothiness of a body; exactly 1 for circles and for anything unregistered. */
export function wheelToothinessOf(body: object): number {
  return wheelToothiness.get(body) ?? 1;
}

export interface ZoneSegment {
  id: string;
  x_start: number;
  x_end: number;
}

export function validateZones(
  raw: unknown,
  terrainMinX: number,
  terrainMaxX: number,
): ZoneSegment[] {
  if (!raw || !Array.isArray(raw) || raw.length === 0) {
    throw new Error("zones[] is required and must be a non-empty array");
  }

  const zones: ZoneSegment[] = [];

  for (let i = 0; i < raw.length; i++) {
    const z = raw[i];
    if (
      !z || typeof z !== "object" || Array.isArray(z) ||
      typeof (z as Record<string, unknown>).id !== "string" ||
      typeof (z as Record<string, unknown>).x_start !== "number" ||
      typeof (z as Record<string, unknown>).x_end !== "number"
    ) {
      throw new Error(`Invalid zone at index ${i}: ${JSON.stringify(z)}`);
    }
    const seg = z as { id: string; x_start: number; x_end: number };
    if (seg.x_start >= seg.x_end) {
      throw new Error(`Zone ${seg.id} has x_start >= x_end (${seg.x_start} >= ${seg.x_end})`);
    }
    zones.push(seg);
  }

  zones.sort((a, b) => a.x_start - b.x_start);

  let prevEnd = terrainMinX;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (Math.abs(z.x_start - prevEnd) > 1e-6) {
      throw new Error(
        `Zone gap or overlap at x=${prevEnd}: zone "${z.id}" starts at ${z.x_start}`,
      );
    }
    prevEnd = z.x_end;
  }
  if (Math.abs(prevEnd - terrainMaxX) > 1e-6) {
    throw new Error(
      `Zone coverage gap: last zone ends at ${prevEnd}, terrain ends at ${terrainMaxX}`,
    );
  }

  return zones;
}

export function createSurfaceContactFilter(
  groundBody: Body,
  surfaces: SurfaceSegment[],
): (contact: Contact) => void {
  return (contact: Contact) => {
    const fA = contact.getFixtureA();
    const fB = contact.getFixtureB();

    if (fA.getBody() !== groundBody && fB.getBody() !== groundBody) return;

    const otherFixture = fA.getBody() === groundBody ? fB : fA;
    if (!otherFixture.getBody().isDynamic()) return;

    const wm = contact.getWorldManifold(null);
    if (!wm || !wm.points || wm.points.length === 0) return;

    const cx = wm.points[0].x;
    const preset = lookupSurface(cx, surfaces);

    let friction = otherFixture.getFriction() * preset.friction;
    // Tooth-terrain interlock (drawrace-8d3baef5): toothed wheels grip
    // interlocking surfaces better than circles. Early-exits at multiplier 1
    // so surfaces without interlock keep the exact legacy friction value.
    if (preset.interlock > 0) {
      const toothiness = wheelToothinessOf(otherFixture.getBody());
      if (toothiness > 1) {
        friction *= 1 + preset.interlock * (toothiness - 1);
      }
    }
    contact.setFriction(friction);
    contact.setRestitution(Math.max(otherFixture.getRestitution(), preset.restitution));
  };
}
