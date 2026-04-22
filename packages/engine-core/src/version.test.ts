import { describe, it, expect } from "vitest";
import { PHYSICS_VERSION } from "./version.js";

describe("PHYSICS_VERSION", () => {
  it("is a positive integer", () => {
    expect(Number.isInteger(PHYSICS_VERSION)).toBe(true);
    expect(PHYSICS_VERSION).toBeGreaterThan(0);
  });
});
