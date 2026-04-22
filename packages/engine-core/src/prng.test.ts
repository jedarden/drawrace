import { describe, it, expect } from "vitest";
import { sfc32, hashSeed } from "./prng.js";

describe("sfc32", () => {
  it("produces values in [0, 1)", () => {
    const rng = sfc32(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic: same seed produces same sequence", () => {
    const a = sfc32(12345);
    const b = sfc32(12345);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it("different seeds produce different first values", () => {
    const a = sfc32(1);
    const b = sfc32(2);
    expect(a.next()).not.toBe(b.next());
  });
});

describe("hashSeed", () => {
  it("returns a 32-bit unsigned integer", () => {
    const h = hashSeed("hills-01", "player-1", 0);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it("produces different hashes for different inputs", () => {
    const a = hashSeed("hills-01", "player-1", 0);
    const b = hashSeed("hills-01", "player-1", 1);
    const c = hashSeed("hills-02", "player-1", 0);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
