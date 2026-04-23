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

describe("SoundManager (Layer 1)", () => {
  beforeEach(() => {
    mockMatchMedia(false);
    localStorage.clear();
    vi.resetModules();
  });

  it("starts disabled by default", async () => {
    const { getSoundManager } = await import("./Sound.js");
    const sound = getSoundManager();
    expect(sound.isEnabled).toBe(false);
  });

  it("can be enabled and persists", async () => {
    const { getSoundManager } = await import("./Sound.js");
    const sound = getSoundManager();
    sound.saveSettings(true);
    expect(sound.isEnabled).toBe(true);
    expect(localStorage.getItem("drawrace.sound")).toBe("true");
  });

  it("can be disabled after enabling", async () => {
    const { getSoundManager } = await import("./Sound.js");
    const sound = getSoundManager();
    sound.saveSettings(true);
    expect(sound.isEnabled).toBe(true);
    sound.saveSettings(false);
    expect(sound.isEnabled).toBe(false);
  });

  it("playCountdown does not throw when disabled", async () => {
    const { getSoundManager } = await import("./Sound.js");
    const sound = getSoundManager();
    expect(() => sound.playCountdown()).not.toThrow();
  });

  it("playGo does not throw when disabled", async () => {
    const { getSoundManager } = await import("./Sound.js");
    const sound = getSoundManager();
    expect(() => sound.playGo()).not.toThrow();
  });

  it("playFinishLine does not throw when disabled", async () => {
    const { getSoundManager } = await import("./Sound.js");
    const sound = getSoundManager();
    expect(() => sound.playFinishLine()).not.toThrow();
  });

  it("playDnf does not throw when disabled", async () => {
    const { getSoundManager } = await import("./Sound.js");
    const sound = getSoundManager();
    expect(() => sound.playDnf()).not.toThrow();
  });

  it("playStrokeClosure does not throw when disabled", async () => {
    const { getSoundManager } = await import("./Sound.js");
    const sound = getSoundManager();
    expect(() => sound.playStrokeClosure()).not.toThrow();
  });

  it("playBounce does not throw when disabled", async () => {
    const { getSoundManager } = await import("./Sound.js");
    const sound = getSoundManager();
    expect(() => sound.playBounce()).not.toThrow();
  });

  it("playWhoosh does not throw when disabled", async () => {
    const { getSoundManager } = await import("./Sound.js");
    const sound = getSoundManager();
    expect(() => sound.playWhoosh()).not.toThrow();
  });

  it("playUiTap does not throw when disabled", async () => {
    const { getSoundManager } = await import("./Sound.js");
    const sound = getSoundManager();
    expect(() => sound.playUiTap()).not.toThrow();
  });

  it("playClear does not throw when disabled", async () => {
    const { getSoundManager } = await import("./Sound.js");
    const sound = getSoundManager();
    expect(() => sound.playClear()).not.toThrow();
  });

  it("motor hum lifecycle does not throw when disabled", async () => {
    const { getSoundManager } = await import("./Sound.js");
    const sound = getSoundManager();
    expect(() => {
      sound.startMotorHum();
      sound.updateMotorSpeed(0.5);
      sound.stopMotorHum();
    }).not.toThrow();
  });

  it("updateMotorSpeed is safe without starting hum", async () => {
    const { getSoundManager } = await import("./Sound.js");
    const sound = getSoundManager();
    expect(() => sound.updateMotorSpeed(0.5)).not.toThrow();
  });

  it("stopMotorHum is safe without starting hum", async () => {
    const { getSoundManager } = await import("./Sound.js");
    const sound = getSoundManager();
    expect(() => sound.stopMotorHum()).not.toThrow();
  });

  it("dispose cleans up without errors", async () => {
    const { getSoundManager } = await import("./Sound.js");
    const sound = getSoundManager();
    sound.saveSettings(true);
    sound.startMotorHum();
    expect(() => sound.dispose()).not.toThrow();
  });

  it("reads settings from localStorage on construction", async () => {
    localStorage.setItem("drawrace.sound", "true");
    vi.resetModules();
    const { getSoundManager } = await import("./Sound.js");
    const sound = getSoundManager();
    expect(sound.isEnabled).toBe(true);
  });
});
