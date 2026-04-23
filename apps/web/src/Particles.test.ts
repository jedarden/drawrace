// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock window.matchMedia for reduced-motion
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

describe("ParticleSystem (Layer 1)", () => {
  beforeEach(() => {
    mockMatchMedia(false);
  });

  it("starts with zero particles", async () => {
    const { ParticleSystem } = await import("./Particles.js");
    const ps = new ParticleSystem();
    expect(ps.count).toBe(0);
  });

  it("emits dust particles when speed is above threshold", async () => {
    const { ParticleSystem } = await import("./Particles.js");
    const ps = new ParticleSystem();
    ps.emitDust(100, 200, 5.0);
    expect(ps.count).toBeGreaterThan(0);
  });

  it("does not emit dust when speed is below threshold", async () => {
    const { ParticleSystem } = await import("./Particles.js");
    const ps = new ParticleSystem();
    ps.emitDust(100, 200, 1.0);
    expect(ps.count).toBe(0);
  });

  it("does not emit dust when particle level is none", async () => {
    const { ParticleSystem } = await import("./Particles.js");
    const ps = new ParticleSystem();
    ps.setParticleLevel("none");
    ps.emitDust(100, 200, 5.0);
    expect(ps.count).toBe(0);
  });

  it("emits confetti particles", async () => {
    const { ParticleSystem } = await import("./Particles.js");
    const ps = new ParticleSystem();
    ps.emitConfetti(200, 300);
    expect(ps.count).toBe(40);
  });

  it("emits reduced confetti count", async () => {
    const { ParticleSystem } = await import("./Particles.js");
    const ps = new ParticleSystem();
    ps.setParticleLevel("reduced");
    ps.emitConfetti(200, 300);
    expect(ps.count).toBe(20);
  });

  it("does not emit confetti when particle level is none", async () => {
    const { ParticleSystem } = await import("./Particles.js");
    const ps = new ParticleSystem();
    ps.setParticleLevel("none");
    ps.emitConfetti(200, 300);
    expect(ps.count).toBe(0);
  });

  it("particles expire after their lifetime", async () => {
    const { ParticleSystem } = await import("./Particles.js");
    const ps = new ParticleSystem();
    ps.emitDust(100, 200, 5.0);
    const countBefore = ps.count;
    expect(countBefore).toBeGreaterThan(0);

    // Advance time beyond dust life (400ms)
    ps.update(0.5);
    expect(ps.count).toBe(0);
  });

  it("clear removes all particles", async () => {
    const { ParticleSystem } = await import("./Particles.js");
    const ps = new ParticleSystem();
    ps.emitConfetti(200, 300);
    expect(ps.count).toBeGreaterThan(0);
    ps.clear();
    expect(ps.count).toBe(0);
  });

  it("respects dust pool max of 64", async () => {
    const { ParticleSystem } = await import("./Particles.js");
    const ps = new ParticleSystem();
    // Emit many dust particles
    for (let i = 0; i < 100; i++) {
      ps.emitDust(100 + i, 200, 5.0);
    }
    const dustCount = ps.count;
    expect(dustCount).toBeLessThanOrEqual(64);
  });

  it("renders without errors on a canvas context", async () => {
    const { ParticleSystem } = await import("./Particles.js");
    const ps = new ParticleSystem();
    ps.emitDust(100, 200, 5.0);

    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 800;
    const ctx = canvas.getContext("2d")!;

    // Should not throw
    expect(() => {
      ps.renderDust(ctx);
      ps.renderConfetti(ctx);
    }).not.toThrow();
  });
});

describe("ParticleSystem reduced-motion (Layer 1)", () => {
  beforeEach(() => {
    mockMatchMedia(true);
  });

  it("uses static dust in reduced-motion mode", async () => {
    const { ParticleSystem } = await import("./Particles.js");
    const ps = new ParticleSystem();
    ps.emitDust(100, 200, 5.0);
    // In reduced-motion, particles aren't added to the array — static state used instead
    expect(ps.count).toBe(0);
  });

  it("uses static confetti in reduced-motion mode", async () => {
    const { ParticleSystem } = await import("./Particles.js");
    const ps = new ParticleSystem();
    ps.emitConfetti(200, 300);
    expect(ps.count).toBe(0);
  });

  it("renders static dust without errors", async () => {
    const { ParticleSystem } = await import("./Particles.js");
    const ps = new ParticleSystem();
    ps.emitDust(100, 200, 5.0);

    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 800;
    const ctx = canvas.getContext("2d")!;

    expect(() => ps.renderDust(ctx)).not.toThrow();
  });
});
