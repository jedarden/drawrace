import { describe, it, expect } from "vitest";
import { InjectedClock } from "./clock.js";

describe("InjectedClock", () => {
  it("starts at the given time", () => {
    const clock = new InjectedClock(1000);
    expect(clock.nowMs()).toBe(1000);
  });

  it("advances by dt", () => {
    const clock = new InjectedClock(0);
    clock.advance(16.667);
    expect(clock.nowMs()).toBeCloseTo(16.667, 3);
  });

  it("accumulates advances", () => {
    const clock = new InjectedClock(0);
    for (let i = 0; i < 60; i++) {
      clock.advance(1000 / 60);
    }
    expect(clock.nowMs()).toBeCloseTo(1000, 0);
  });
});
