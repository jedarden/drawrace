// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

describe("PerformanceManager (Layer 1)", () => {
  beforeEach(() => {
    mockMatchMedia(false);
    vi.resetModules();
  });

  it("starts at full quality and 60Hz", async () => {
    // Need fresh module
    vi.resetModules();
    const { getPerformanceManager } = await import("./PerformanceManager.js");
    const pm = getPerformanceManager();
    pm.reset();

    expect(pm.particleLevel).toBe("full");
    expect(pm.maxGhosts).toBe(3);
    expect(pm.simFrequency).toBe(60);
    expect(pm.simDt).toBeCloseTo(1 / 60, 6);
  });

  it("does not degrade before 20 samples", async () => {
    vi.resetModules();
    const { getPerformanceManager } = await import("./PerformanceManager.js");
    const pm = getPerformanceManager();
    pm.reset();

    // Record 19 slow frames (below threshold check count)
    for (let i = 0; i < 19; i++) {
      pm.recordFrame(40);
    }
    expect(pm.particleLevel).toBe("full");
  });

  it("degrades particles when frame times are high", async () => {
    vi.resetModules();
    const { getPerformanceManager } = await import("./PerformanceManager.js");
    const pm = getPerformanceManager();
    pm.reset();

    // Record 25 slow frames
    for (let i = 0; i < 25; i++) {
      pm.recordFrame(25);
    }
    expect(pm.particleLevel).toBe("reduced");
  });

  it("disables particles when frame times are very high", async () => {
    vi.resetModules();
    const { getPerformanceManager } = await import("./PerformanceManager.js");
    const pm = getPerformanceManager();
    pm.reset();

    for (let i = 0; i < 25; i++) {
      pm.recordFrame(35);
    }
    expect(pm.particleLevel).toBe("none");
  });

  it("reduces ghost count under load", async () => {
    vi.resetModules();
    const { getPerformanceManager } = await import("./PerformanceManager.js");
    const pm = getPerformanceManager();
    pm.reset();

    for (let i = 0; i < 25; i++) {
      pm.recordFrame(30);
    }
    expect(pm.maxGhosts).toBe(1);
  });

  it("drops to 30Hz when frames are consistently slow", async () => {
    vi.resetModules();
    const { getPerformanceManager } = await import("./PerformanceManager.js");
    const pm = getPerformanceManager();
    pm.reset();

    for (let i = 0; i < 25; i++) {
      pm.recordFrame(40);
    }
    expect(pm.simFrequency).toBe(30);
    expect(pm.simDt).toBeCloseTo(1 / 30, 6);
  });

  it("reset restores full quality", async () => {
    vi.resetModules();
    const { getPerformanceManager } = await import("./PerformanceManager.js");
    const pm = getPerformanceManager();
    pm.reset();

    for (let i = 0; i < 25; i++) {
      pm.recordFrame(40);
    }
    expect(pm.particleLevel).toBe("none");

    pm.reset();
    expect(pm.particleLevel).toBe("full");
    expect(pm.maxGhosts).toBe(3);
    expect(pm.simFrequency).toBe(60);
  });

  it("starts with no particles in reduced-motion mode", async () => {
    mockMatchMedia(true);
    vi.resetModules();
    const { getPerformanceManager } = await import("./PerformanceManager.js");
    const pm = getPerformanceManager();
    pm.reset();

    expect(pm.particleLevel).toBe("none");
  });
});
