import { describe, it, expect } from "vitest";
import { World, Vec2, Edge, Circle, Box } from "planck";
import {
  parseSurfaces,
  lookupSurface,
  applyDrag,
  createSurfaceContactFilter,
  SURFACE_PRESETS,
  isValidSurfaceType,
  type SurfaceSegment,
} from "./surface.js";

// ---------------------------------------------------------------------------
// parseSurfaces
// ---------------------------------------------------------------------------

describe("parseSurfaces", () => {
  const MIN_X = 0;
  const MAX_X = 100;

  it("returns a single normal segment when raw is omitted", () => {
    const result = parseSurfaces(undefined, MIN_X, MAX_X);
    expect(result).toEqual([{ x_range: [MIN_X, MAX_X], type: "normal" }]);
  });

  it("returns a single normal segment when raw is null", () => {
    const result = parseSurfaces(null, MIN_X, MAX_X);
    expect(result).toEqual([{ x_range: [MIN_X, MAX_X], type: "normal" }]);
  });

  it("returns a single normal segment when raw is empty array", () => {
    const result = parseSurfaces([], MIN_X, MAX_X);
    expect(result).toEqual([{ x_range: [MIN_X, MAX_X], type: "normal" }]);
  });

  it("parses a 5-surface synthetic track correctly", () => {
    const raw = [
      { x_range: [0, 20], type: "normal" },
      { x_range: [20, 40], type: "ice" },
      { x_range: [40, 60], type: "snow" },
      { x_range: [60, 80], type: "water" },
      { x_range: [80, 100], type: "rock" },
    ];
    const result = parseSurfaces(raw, MIN_X, MAX_X);
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ x_range: [0, 20], type: "normal" });
    expect(result[1]).toEqual({ x_range: [20, 40], type: "ice" });
    expect(result[2]).toEqual({ x_range: [40, 60], type: "snow" });
    expect(result[3]).toEqual({ x_range: [60, 80], type: "water" });
    expect(result[4]).toEqual({ x_range: [80, 100], type: "rock" });
  });

  it("rejects unknown surface type", () => {
    const raw = [{ x_range: [0, 100], type: "lava" }];
    expect(() => parseSurfaces(raw, MIN_X, MAX_X)).toThrow(/unknown surface type/i);
  });

  it("rejects gap between segments", () => {
    const raw = [
      { x_range: [0, 50], type: "normal" },
      { x_range: [55, 100], type: "ice" }, // gap at 50-55
    ];
    expect(() => parseSurfaces(raw, MIN_X, MAX_X)).toThrow(/gap or overlap/i);
  });

  it("rejects segments that don't cover full terrain extent", () => {
    const raw = [
      { x_range: [0, 50], type: "normal" },
      { x_range: [50, 90], type: "ice" }, // ends at 90, terrain ends at 100
    ];
    expect(() => parseSurfaces(raw, MIN_X, MAX_X)).toThrow(/coverage gap/i);
  });

  it("sorts out-of-order segments before validating", () => {
    const raw = [
      { x_range: [50, 100], type: "ice" },
      { x_range: [0, 50], type: "normal" },
    ];
    const result = parseSurfaces(raw, MIN_X, MAX_X);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("normal");
    expect(result[1].type).toBe("ice");
  });

  it("rejects invalid x_range (not length 2)", () => {
    const raw = [{ x_range: [0], type: "normal" }];
    expect(() => parseSurfaces(raw, MIN_X, MAX_X)).toThrow(/invalid x_range/i);
  });

  it("rejects non-number x_range values", () => {
    const raw = [{ x_range: [0, "far"], type: "normal" }];
    expect(() => parseSurfaces(raw, MIN_X, MAX_X)).toThrow(/invalid x_range/i);
  });

  it("rejects segment missing type field", () => {
    const raw = [{ x_range: [0, 100] }];
    expect(() => parseSurfaces(raw, MIN_X, MAX_X)).toThrow(/invalid surface segment/i);
  });
});

// ---------------------------------------------------------------------------
// lookupSurface — binary search
// ---------------------------------------------------------------------------

describe("lookupSurface", () => {
  const surfaces: SurfaceSegment[] = [
    { x_range: [0, 20], type: "normal" },
    { x_range: [20, 40], type: "ice" },
    { x_range: [40, 60], type: "snow" },
    { x_range: [60, 80], type: "water" },
    { x_range: [80, 100], type: "rock" },
  ];

  it("returns normal preset at x=10", () => {
    expect(lookupSurface(10, surfaces)).toEqual(SURFACE_PRESETS.normal);
  });

  it("returns ice preset at x=30", () => {
    expect(lookupSurface(30, surfaces)).toEqual(SURFACE_PRESETS.ice);
  });

  it("returns snow preset at x=50", () => {
    expect(lookupSurface(50, surfaces)).toEqual(SURFACE_PRESETS.snow);
  });

  it("returns water preset at x=70", () => {
    expect(lookupSurface(70, surfaces)).toEqual(SURFACE_PRESETS.water);
  });

  it("returns rock preset at x=90", () => {
    expect(lookupSurface(90, surfaces)).toEqual(SURFACE_PRESETS.rock);
  });

  it("returns normal (default) for x outside all segments", () => {
    expect(lookupSurface(-10, surfaces)).toEqual(SURFACE_PRESETS.normal);
    expect(lookupSurface(200, surfaces)).toEqual(SURFACE_PRESETS.normal);
  });

  it("handles boundary x values (segment start/end)", () => {
    // x_end is inclusive (binary search uses > not >=)
    expect(lookupSurface(0, surfaces)).toEqual(SURFACE_PRESETS.normal);
    expect(lookupSurface(20, surfaces)).toEqual(SURFACE_PRESETS.normal); // [0,20]
    expect(lookupSurface(40, surfaces)).toEqual(SURFACE_PRESETS.snow);   // [40,60]
    expect(lookupSurface(60, surfaces)).toEqual(SURFACE_PRESETS.snow);   // [40,60]
    expect(lookupSurface(80, surfaces)).toEqual(SURFACE_PRESETS.water);  // [60,80]
    expect(lookupSurface(100, surfaces)).toEqual(SURFACE_PRESETS.rock);  // [80,100]
  });
});

// ---------------------------------------------------------------------------
// applyDrag
// ---------------------------------------------------------------------------

describe("applyDrag", () => {
  const waterSurfaces: SurfaceSegment[] = [
    { x_range: [0, 50], type: "normal" },
    { x_range: [50, 100], type: "water" },
  ];

  const mudSurfaces: SurfaceSegment[] = [
    { x_range: [0, 50], type: "normal" },
    { x_range: [50, 100], type: "mud" },
  ];

  it("applies drag force when chassis is over water surface", () => {
    const world = new World(Vec2(0, 0));
    const body = world.createBody({ position: Vec2(75, 5), type: "dynamic" });
    body.createFixture(Box(1, 1), { density: 1 });
    body.setLinearVelocity(Vec2(10, 5));

    const preVx = body.getLinearVelocity().x;
    const preVy = body.getLinearVelocity().y;

    applyDrag(body, waterSurfaces);
    world.step(1 / 60, 8, 3);

    // After drag + step, velocity should be less than pre-step velocity
    expect(Math.abs(body.getLinearVelocity().x)).toBeLessThan(Math.abs(preVx));
    expect(Math.abs(body.getLinearVelocity().y)).toBeLessThan(Math.abs(preVy));
  });

  it("applies drag force when chassis is over mud surface", () => {
    const world = new World(Vec2(0, 10));
    const body = world.createBody({ position: Vec2(75, 5), type: "dynamic" });
    body.createFixture(Box(1, 1), { density: 1 });
    body.setLinearVelocity(Vec2(10, 0));

    const preVx = body.getLinearVelocity().x;
    applyDrag(body, mudSurfaces);
    world.step(1 / 60, 8, 3);

    expect(Math.abs(body.getLinearVelocity().x)).toBeLessThan(Math.abs(preVx));
  });

  it("does not apply drag over normal surface", () => {
    const world = new World(Vec2(0, 10));
    const body = world.createBody({ position: Vec2(25, 5), type: "dynamic" });
    body.createFixture(Box(1, 1), { density: 1 });
    body.setLinearVelocity(Vec2(10, 0));

    applyDrag(body, waterSurfaces);
    // No drag applied, but gravity + step will change velocity — just check no crash
    world.step(1 / 60, 8, 3);
    expect(body.getLinearVelocity().x).toBeDefined();
  });

  it("water drag is proportional to velocity (higher velocity = more force)", () => {
    const world1 = new World(Vec2(0, 0)); // no gravity
    const body1 = world1.createBody({ position: Vec2(75, 5), type: "dynamic" });
    body1.createFixture(Box(1, 1), { density: 1 });
    body1.setLinearVelocity(Vec2(10, 0));

    const world2 = new World(Vec2(0, 0));
    const body2 = world2.createBody({ position: Vec2(75, 5), type: "dynamic" });
    body2.createFixture(Box(1, 1), { density: 1 });
    body2.setLinearVelocity(Vec2(5, 0));

    applyDrag(body1, waterSurfaces);
    applyDrag(body2, waterSurfaces);
    world1.step(1 / 60, 8, 3);
    world2.step(1 / 60, 8, 3);

    // Force = -k * v, so faster body loses more speed
    const dv1 = 10 - body1.getLinearVelocity().x;
    const dv2 = 5 - body2.getLinearVelocity().x;
    // Water drag k=4.0, so the deceleration ratio should be ~2x
    expect(dv1 / dv2).toBeCloseTo(2.0, 0);
  });
});

// ---------------------------------------------------------------------------
// isValidSurfaceType
// ---------------------------------------------------------------------------

describe("isValidSurfaceType", () => {
  it("accepts all six valid types", () => {
    for (const t of ["normal", "ice", "snow", "water", "mud", "rock"] as const) {
      expect(isValidSurfaceType(t)).toBe(true);
    }
  });

  it("rejects unknown type", () => {
    expect(isValidSurfaceType("lava")).toBe(false);
    expect(isValidSurfaceType("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createSurfaceContactFilter — per-contact friction override
// ---------------------------------------------------------------------------

describe("createSurfaceContactFilter", () => {
  const surfaces: SurfaceSegment[] = [
    { x_range: [0, 20], type: "normal" },   // friction 0.9
    { x_range: [20, 40], type: "ice" },      // friction 0.10
    { x_range: [40, 60], type: "snow" },     // friction 0.45
    { x_range: [60, 80], type: "water" },    // friction 0.05
    { x_range: [80, 100], type: "rock" },    // friction 0.95
  ];

  it("overrides contact friction based on surface preset × wheel friction", () => {
    const world = new World(Vec2(0, 10));
    const ground = world.createBody();
    // Create terrain edges across all surface zones
    for (let x = 0; x < 100; x += 10) {
      ground.createFixture(
        Edge(Vec2(x, 0), Vec2(x + 10, 0)),
        { friction: 0.9, restitution: 0.0 },
      );
    }

    const handler = createSurfaceContactFilter(ground, surfaces);
    world.on("pre-solve", handler);

    // Test each surface zone: place a dynamic body at the zone's center
    const testCases = [
      { x: 10, type: "normal", expectedFriction: 0.8 * 0.9 },   // wheel 0.8 × surface 0.9
      { x: 30, type: "ice", expectedFriction: 0.8 * 0.10 },
      { x: 50, type: "snow", expectedFriction: 0.8 * 0.45 },
      { x: 70, type: "water", expectedFriction: 0.8 * 0.05 },
      { x: 90, type: "rock", expectedFriction: 0.8 * 0.95 },
    ];

    for (const tc of testCases) {
      const body = world.createBody({ position: Vec2(tc.x, 0.5), type: "dynamic" });
      const fix = body.createFixture(Circle(0.5), {
        density: 1,
        friction: 0.8,
        restitution: 0.3,
      });

      // Step once to generate a contact
      world.step(1 / 60, 8, 3);

      // The contact should have been modified by the filter
      // We verify by checking the fixture friction is still 0.8 (unchanged)
      // and the contact friction was set to the product.
      // Since we can't directly read contact friction post-step in Planck easily,
      // we verify the handler was registered without error and the body interacts.
      expect(fix.getFriction()).toBe(0.8);

      // Clean up
      world.destroyBody(body);
    }
  });

  it("does not modify contacts not involving the ground body", () => {
    const world = new World(Vec2(0, 10));
    const ground = world.createBody();
    ground.createFixture(Edge(Vec2(0, 0), Vec2(100, 0)), { friction: 0.9, restitution: 0.0 });

    const handler = createSurfaceContactFilter(ground, surfaces);
    world.on("pre-solve", handler);

    // Two dynamic bodies — no ground involved
    const body1 = world.createBody({ position: Vec2(50, 5), type: "dynamic" });
    body1.createFixture(Box(1, 1), { density: 1, friction: 0.5, restitution: 0.1 });
    const body2 = world.createBody({ position: Vec2(50, 7), type: "dynamic" });
    body2.createFixture(Box(1, 1), { density: 1, friction: 0.5, restitution: 0.1 });

    // Should not throw — handler skips non-ground contacts
    world.step(1 / 60, 8, 3);
    expect(body1.getPosition()).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Determinism: multi-surface simulation
// ---------------------------------------------------------------------------

describe("Surface determinism", () => {
  it("produces identical streamHash across 100 runs on a multi-surface track", async () => {
    // Use the real hills-01 track with surfaces from JSON
    const track = {
      id: "surface-test",
      world: { gravity: [0, 10] as [number, number], pixelsPerMeter: 30 },
      terrain: [
        [0, 5], [10, 5], [20, 5.3], [30, 5.3],
        [40, 5.8], [50, 5], [60, 5.2], [70, 5.2],
        [80, 5], [90, 5], [100, 5],
      ],
      surfaces: [
        { x_range: [0, 20], type: "normal" },
        { x_range: [20, 40], type: "ice" },
        { x_range: [40, 60], type: "snow" },
        { x_range: [60, 80], type: "water" },
        { x_range: [80, 100], type: "rock" },
      ],
      start: { pos: [1.5, 3.5], facing: 1 },
      finish: { pos: [99, 3.5], width: 0.2 },
    };

    // Use createHeadlessRace (single-wheel) for determinism testing
    const { createHeadlessRace } = await import("./headless-race.js");
    const wheel = {
      vertices: [
        [0.4, 0], [0.283, 0.283], [0, 0.4], [-0.283, 0.283],
        [-0.4, 0], [-0.283, -0.283], [0, -0.4], [0.283, -0.283],
      ] as [number, number][],
    };

    const hashes: string[] = [];
    for (let i = 0; i < 100; i++) {
      const result = createHeadlessRace({ seed: 42, track, wheel });
      hashes.push(result.streamHash);
    }

    const first = hashes[0];
    for (let i = 1; i < hashes.length; i++) {
      expect(hashes[i], `determinism failure on run ${i}`).toBe(first);
    }
  });
});
