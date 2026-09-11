import { Vec2 } from "planck";
import type { Body, Contact } from "planck";
import { wheelProfile, MIN_EFFECTIVE_RADIUS, type WheelProfile } from "./swap.js";

export type SurfaceType = "normal" | "ice" | "snow" | "water" | "mud" | "rock";

export const SURFACE_TYPES: readonly SurfaceType[] = [
  "normal", "ice", "snow", "water", "mud", "rock",
] as const;

export interface SurfacePreset {
  friction: number;
  restitution: number;
  /** Chassis linear drag (N·s/m), applied to the chassis body. Wheel-independent. */
  drag: number;
  /**
   * Per-wheel sinkage drag (N·s/m at SINKAGE_REF_RADIUS), applied to each
   * wheel body scaled by (SINKAGE_REF_RADIUS / rollingRadius)^SINKAGE_EXPONENT.
   * Soft surfaces give under big wheels (they ride on top) and over small
   * ones (they dig in) — the wheel-surface interaction the chassis-only drag
   * could never express (drawrace-8d3baef5).
   */
  sinkage: number;
  /**
   * Per-wheel plow drag (N·s/m at SINKAGE_REF_RADIUS) on fluid surfaces,
   * scaled by (rollingRadius / SINKAGE_REF_RADIUS)^PLOW_TUNING.exponent — a
   * bigger wheel displaces more fluid. Runs OPPOSITE to sinkage, so a fluid
   * surface carrying both terms has an interior optimum: small wheels dig,
   * big wheels plow (drawrace-8d3baef5, zone D medium-wheel story).
   */
  plow: number;
  /**
   * Tooth-interlock gain for wheel bodies: contact friction is multiplied by
   * max(0, 1 + interlock × wheelRoughness). Positive where teeth bite into a
   * surface a smooth circle merely slides over (ice, snow); zero where the
   * radius-scaled drag terms are the wheel-size lever (fluids, soft mud);
   * large smooth wheels gain nothing anywhere — roughness is only ever a
   * wheel-shape term (drawrace-8d3baef5).
   */
  interlock: number;
}

// Extreme surface values to force wheel differentiation.
// `drag` acts on the chassis; `sinkage`/`plow` are the per-wheel radius-scaled
// terms (sinkage over small wheels, plow over big ones); `interlock` is the
// per-wheel tooth-friction gain.
export const SURFACE_PRESETS: Record<SurfaceType, SurfacePreset> = {
  normal: { friction: 0.9,  restitution: 0.0,  drag: 0,    sinkage: 0,   plow: 0, interlock: 0 },
  ice:    { friction: 0.1,  restitution: 0.0,  drag: 0,    sinkage: 0,   plow: 0, interlock: 4 },  // Extremely slippery - teeth essential
  snow:   { friction: 0.4,  restitution: 0.0,  drag: 1.5,  sinkage: 2.5, plow: 0, interlock: 3 },  // Soft - large wheels ride on top, small dig in, teeth bite
  water:  { friction: 0.05, restitution: 0.0,  drag: 3.0,  sinkage: 3.5, plow: 6.0, interlock: 0 }, // Fluid - small wheels sink, big wheels plow
  mud:    { friction: 0.5,  restitution: 0.0,  drag: 12.0, sinkage: 5.0, plow: 0, interlock: 0 },  // Very heavy drag - deepest sinkage
  rock:   { friction: 0.95, restitution: 0.25, drag: 0,    sinkage: 0,   plow: 0, interlock: 0 },
};

/**
 * Wheel-surface interaction constants (drawrace-8d3baef5).
 *
 * Sinkage: per-wheel drag scales as (SINKAGE_REF_RADIUS / rollingRadius)^
 * SINKAGE_EXPONENT, so at the reference radius a wheel feels the preset value,
 * bigger wheels less than 1×, smaller wheels more. The exponent is the
 * physically-motivated middle ground between contact-length (∝ r) and
 * plan-view-area (∝ r²) load spreading over a soft bed.
 *
 * Plow: per-wheel drag scales as (rollingRadius / SINKAGE_REF_RADIUS)^
 * PLOW_TUNING.exponent — wetted/displaced volume grows with the wheel's
 * submerged cross-section. The exponent is the tuning knob that sets how
 * SHARPLY a fluid preset can resolve adjacent candidate radii: for any drag
 * field with an interior optimum the relative change across a 4-5% radius step
 * is bounded by the field's log-elasticity at the optimum, and the natural r³
 * wetted-volume curve is too flat there to separate neighbours by the design
 * margin (drawrace-8d3baef5 zone D). The per-preset coefficient ratio still
 * places the optimum itself.
 *
 * Interlock: contact friction for wheel bodies is multiplied by
 * (1 + preset.interlock × wheelRoughness) — teeth bite into surfaces a smooth
 * circle merely slides over (plan §Gameplay 5).
 */
export const SINKAGE_REF_RADIUS = 0.5;
export const SINKAGE_EXPONENT = 2;
/** Patch per config in the calibration harness, same convention as MOTOR_TORQUE_TUNING. */
export const PLOW_TUNING = { exponent: 3 };

export interface SurfaceSegment {
  x_range: [number, number];
  type: SurfaceType;
}

const VALID_SURFACE_SET = new Set<string>(SURFACE_TYPES);

export function isValidSurfaceType(type: string): type is SurfaceType {
  return VALID_SURFACE_SET.has(type);
}

export function parseSurfaces(
  raw: unknown,
  terrainMinX: number,
  terrainMaxX: number,
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

/** Segment under `x` by binary search; a synthetic "normal" past the ends. */
export function lookupSurfaceSegment(x: number, surfaces: SurfaceSegment[]): SurfaceSegment {
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
      return seg;
    }
  }
  return { x_range: [-Infinity, Infinity], type: "normal" };
}

export function lookupSurface(x: number, surfaces: SurfaceSegment[]): SurfacePreset {
  return SURFACE_PRESETS[lookupSurfaceSegment(x, surfaces).type];
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
 * Sinkage drag multiplier for a wheel of `radius` on a soft surface: the
 * reference-radius wheel feels 1×, bigger wheels under, smaller wheels over.
 * Deliberately mass-independent — on a soft bed a smaller contact patch sinks
 * deeper at the SAME load, so the punishing scaling applies to the light small
 * wheel doubly (same multiplier, less weight carrying momentum through it).
 */
export function sinkageFactor(radius: number): number {
  return (
    SINKAGE_REF_RADIUS / Math.max(radius, MIN_EFFECTIVE_RADIUS)
  ) ** SINKAGE_EXPONENT;
}

/** Plow drag multiplier: 1× at the reference radius, over for bigger wheels. */
export function plowFactor(radius: number): number {
  return (
    Math.max(radius, MIN_EFFECTIVE_RADIUS) / SINKAGE_REF_RADIUS
  ) ** PLOW_TUNING.exponent;
}

/**
 * Per-wheel surface drag: the preset's `sinkage` (soft beds, over small
 * wheels) and `plow` (fluids, over big wheels) opposing the wheel's own
 * velocity, looked up at the wheel's x (not the chassis's — on a slope the two
 * straddle a boundary). Zero wherever the preset carries neither term.
 */
export function applyWheelDrag(
  wheelBody: Body,
  profile: WheelProfile,
  surfaces: SurfaceSegment[],
): void {
  const preset = lookupSurface(wheelBody.getPosition().x, surfaces);
  if (preset.sinkage > 0 || preset.plow > 0) {
    const vel = wheelBody.getLinearVelocity();
    const drag = preset.sinkage * sinkageFactor(profile.radius)
      + preset.plow * plowFactor(profile.radius);
    wheelBody.applyForceToCenter(
      Vec2(-drag * vel.x, -drag * vel.y),
    );
  }
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

/**
 * Per-contact surface tuning. `wheelRoughnessOf` (optional) resolves a dynamic
 * body to its wheelRoughness; pass a resolver bound to the sim's wheel set to
 * enable tooth-interlock — on contacts whose preset carries a non-zero
 * `interlock` gain, resolved bodies get friction multiplied by
 * (1 + interlock × roughness): teeth clawing into surface a smooth circle
 * merely slides over. Bodies resolving to 0 (chassis, untracked) behave
 * exactly as before.
 */
export function createSurfaceContactFilter(
  groundBody: Body,
  surfaces: SurfaceSegment[],
  wheelRoughnessOf?: (body: Body) => number,
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

    let interlock = 1;
    const seg = lookupSurfaceSegment(cx, surfaces);
    if (SURFACE_PRESETS[seg.type].interlock !== 0 && wheelRoughnessOf) {
      // Interlock only where the preset declares teeth can bite (ice, snow).
      // Keying on the preset field keeps water/mud interlock-free: their
      // radius-scaled drag terms are the wheel-size lever there, and teeth
      // riding high on the perimeter/2π radius would otherwise coast over
      // them scot-free.
      const roughness = wheelRoughnessOf(otherFixture.getBody());
      if (roughness > 0) interlock = Math.max(0, 1 + SURFACE_PRESETS[seg.type].interlock * roughness);
    }

    contact.setFriction(otherFixture.getFriction() * preset.friction * interlock);
    contact.setRestitution(Math.max(otherFixture.getRestitution(), preset.restitution));
  };
}
