// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockMatchMedia = (reducedMotion: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? reducedMotion : false,
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

describe("Haptics (Layer 1)", () => {
  beforeEach(() => {
    mockMatchMedia(false);
    localStorage.clear();
    vi.resetModules();
  });

  it("starts disabled by default", async () => {
    const { getHaptics } = await import("./Haptics.js");
    const haptics = getHaptics();
    expect(haptics.isEnabled).toBe(false);
  });

  it("can be enabled and persists", async () => {
    const { getHaptics } = await import("./Haptics.js");
    const haptics = getHaptics();
    haptics.saveSettings(true);
    expect(haptics.isEnabled).toBe(true);
    expect(localStorage.getItem("drawrace.haptics")).toBe("true");
  });

  it("can be disabled after enabling", async () => {
    const { getHaptics } = await import("./Haptics.js");
    const haptics = getHaptics();
    haptics.saveSettings(true);
    haptics.saveSettings(false);
    expect(haptics.isEnabled).toBe(false);
  });

  it("reads settings from localStorage", async () => {
    localStorage.setItem("drawrace.haptics", "true");
    vi.resetModules();
    const { getHaptics } = await import("./Haptics.js");
    const haptics = getHaptics();
    expect(haptics.isEnabled).toBe(true);
  });

  it("calls navigator.vibrate when enabled", async () => {
    const vibrateSpy = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "vibrate", {
      writable: true,
      value: vibrateSpy,
    });

    const { getHaptics } = await import("./Haptics.js");
    const haptics = getHaptics();
    haptics.saveSettings(true);
    haptics.tap(50);
    expect(vibrateSpy).toHaveBeenCalledWith(50);
  });

  it("does not vibrate when disabled", async () => {
    const vibrateSpy = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "vibrate", {
      writable: true,
      value: vibrateSpy,
    });

    const { getHaptics } = await import("./Haptics.js");
    const haptics = getHaptics();
    haptics.tap(50);
    expect(vibrateSpy).not.toHaveBeenCalled();
  });

  it("strokeClosure triggers short vibration", async () => {
    const vibrateSpy = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "vibrate", {
      writable: true,
      value: vibrateSpy,
    });

    const { getHaptics } = await import("./Haptics.js");
    const haptics = getHaptics();
    haptics.saveSettings(true);
    haptics.strokeClosure();
    expect(vibrateSpy).toHaveBeenCalledWith(10);
  });

  it("raceStart triggers vibration", async () => {
    const vibrateSpy = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "vibrate", {
      writable: true,
      value: vibrateSpy,
    });

    const { getHaptics } = await import("./Haptics.js");
    const haptics = getHaptics();
    haptics.saveSettings(true);
    haptics.raceStart();
    expect(vibrateSpy).toHaveBeenCalledWith(20);
  });

  it("finishLine triggers pattern vibration", async () => {
    const vibrateSpy = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "vibrate", {
      writable: true,
      value: vibrateSpy,
    });

    const { getHaptics } = await import("./Haptics.js");
    const haptics = getHaptics();
    haptics.saveSettings(true);
    haptics.finishLine();
    expect(vibrateSpy).toHaveBeenCalledWith([40, 20, 40]);
  });

  it("all methods are safe without navigator.vibrate", async () => {
    Object.defineProperty(navigator, "vibrate", {
      writable: true,
      value: undefined,
    });

    const { getHaptics } = await import("./Haptics.js");
    const haptics = getHaptics();
    haptics.saveSettings(true);
    expect(() => {
      haptics.tap(10);
      haptics.pattern([10, 20, 10]);
      haptics.strokeClosure();
      haptics.raceStart();
      haptics.finishLine();
      haptics.dnf();
      haptics.uiTap();
    }).not.toThrow();
  });
});
