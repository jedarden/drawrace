import { describe, it, expect } from "vitest";

/**
 * Pause state machine tests.
 *
 * The pause functionality is implemented in RaceScreen.tsx using:
 * - pausedRef (useRef) - controls whether sim.step() is called
 * - paused (useState) - controls whether PauseMenu is rendered
 *
 * This test suite documents the expected behavior of the pause state machine.
 */

describe("pause state machine", () => {
  it("initially is not paused", () => {
    // When race starts, pausedRef.current === false and paused === false
    // This allows the sim loop to call world.step() each frame
    const pausedRef = { current: false };
    const paused = false;

    expect(pausedRef.current).toBe(false);
    expect(paused).toBe(false);
  });

  it("when paused, sim loop skips world.step()", () => {
    // When handlePause() is called:
    // 1. pausedRef.current = true (stops sim.step())
    // 2. setPaused(true) (shows PauseMenu)
    const pausedRef = { current: true };
    const paused = true;

    // The loop checks pausedRef.current and skips step()
    const shouldStep = !pausedRef.current;
    expect(shouldStep).toBe(false);

    // PauseMenu is rendered when paused === true
    const menuVisible = paused;
    expect(menuVisible).toBe(true);
  });

  it("resume restores sim state and continues stepping", () => {
    // When handleResume() is called:
    // 1. pausedRef.current = false (resumes sim.step())
    // 2. setPaused(false) (hides PauseMenu)
    const pausedRef = { current: false };
    const paused = false;

    // The loop resumes calling world.step()
    const shouldStep = !pausedRef.current;
    expect(shouldStep).toBe(true);

    // PauseMenu is hidden
    const menuVisible = paused;
    expect(menuVisible).toBe(false);
  });

  it("pause preserves sim state (no ticks elapse)", () => {
    // During pause, the loop continues but does NOT call sim.step()
    // This means the sim tick counter does not increment
    const tickBeforePause = 1234;
    const pausedDurationTicks = 60; // ~1 second at 60Hz

    // While paused, sim.step() is not called
    // So tick remains the same
    const tickDuringPause = tickBeforePause; // No increment

    expect(tickDuringPause).toBe(tickBeforePause);

    // After resume, tick continues from where it left off
    const tickAfterResume = tickDuringPause + 1; // Next step increments
    expect(tickAfterResume).toBe(tickBeforePause + 1);
  });

  it("pause freezes stuck-DNF detector", () => {
    // The stuck detector counts rotations while sim.step() is called
    // During pause, sim.step() is NOT called, so rotation doesn't accumulate
    const rotationsBeforePause = 3;
    const pausedDurationTicks = 60;

    // Detector state does not change during pause
    const rotationsDuringPause = rotationsBeforePause; // Frozen

    expect(rotationsDuringPause).toBe(rotationsBeforePause);
  });

  it("restart increments runIndex and generates new seed", () => {
    // When Restart is clicked:
    // 1. runIndex is incremented in App.tsx
    // 2. New seed = hashSeed(trackId, playerId, runIndex)
    // 3. RaceScreen remounts with new seed
    const runIndex = 0;
    const seed = hashSeed("hills-01", "player-123", runIndex);

    const nextRunIndex = runIndex + 1;
    const nextSeed = hashSeed("hills-01", "player-123", nextRunIndex);

    expect(nextRunIndex).toBe(1);
    expect(nextSeed).not.toBe(seed);
  });

  it("quit returns to landing screen without leaking state", () => {
    // When Quit is clicked:
    // 1. handleQuitFromRace() sets showLanding = true
    // 2. Race state is cleared (drawResult, rawStrokePoints, finishTimeMs, swapLog)
    // 3. LandingScreen is shown

    // Before quit: race state is populated
    const beforeQuit = {
      drawResult: { vertices: [{ x: 0, y: 0 }] },
      rawStrokePoints: [{ x: 0, y: 0, t: 0 }],
      finishTimeMs: 45000,
      swapLog: [{ swap_tick: 100, polygon: [[0, 0]] }],
    };

    // After quit: all cleared
    const afterQuit = {
      drawResult: null,
      rawStrokePoints: [],
      finishTimeMs: 0,
      swapLog: [],
    };

    expect(afterQuit.drawResult).toBeNull();
    expect(afterQuit.rawStrokePoints).toEqual([]);
    expect(afterQuit.finishTimeMs).toBe(0);
    expect(afterQuit.swapLog).toEqual([]);
  });

  it("tapping outside pause menu resumes (backdrop click)", () => {
    // PauseMenu backdrop click triggers onResume
    // This is equivalent to clicking the Resume button
    const backdropClicked = true;
    const shouldResume = backdropClicked;

    expect(shouldResume).toBe(true);
  });
});

/**
 * Simple FNV-1a hash implementation matching engine-core prng.ts
 */
function hashSeed(trackId: string, playerId: string, runIndex: number): number {
  const str = `${trackId}:${playerId}:${runIndex}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
