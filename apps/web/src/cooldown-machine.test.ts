import { describe, it, expect } from "vitest";
import {
  MAX_SWAPS,
  COOLDOWN_MS,
  initialSwapState,
  activateSwapMachine,
  deactivateSwapMachine,
  canAcceptSwap,
  commitSwapState,
  tickSwapMachine,
  getCooldownProgress,
} from "./cooldown-machine.js";

describe("cooldown state machine — initial state", () => {
  it("starts in inactive phase with zero swaps", () => {
    const s = initialSwapState();
    expect(s.phase).toBe("inactive");
    expect(s.swapCount).toBe(0);
  });

  it("cannot accept swap when inactive", () => {
    expect(canAcceptSwap(initialSwapState(), 0)).toBe(false);
  });

  it("cooldown progress is 0 when inactive", () => {
    expect(getCooldownProgress(initialSwapState(), 1000)).toBe(0);
  });
});

describe("cooldown state machine — activation", () => {
  it("activating from inactive moves to active when under cap", () => {
    const s = activateSwapMachine(initialSwapState());
    expect(s.phase).toBe("active");
  });

  it("activating from inactive moves to capped when at MAX_SWAPS", () => {
    const s = activateSwapMachine({ ...initialSwapState(), swapCount: MAX_SWAPS });
    expect(s.phase).toBe("capped");
  });

  it("activating when already active is a no-op", () => {
    const s0 = activateSwapMachine(initialSwapState());
    const s1 = activateSwapMachine(s0);
    expect(s1.phase).toBe("active");
  });

  it("deactivating moves any phase to inactive", () => {
    const active = activateSwapMachine(initialSwapState());
    expect(deactivateSwapMachine(active).phase).toBe("inactive");

    const inCooldown = commitSwapState(active, 0);
    expect(deactivateSwapMachine(inCooldown).phase).toBe("inactive");
  });
});

describe("cooldown state machine — acceptance rules", () => {
  it("can accept swap when active", () => {
    const s = activateSwapMachine(initialSwapState());
    expect(canAcceptSwap(s, 0)).toBe(true);
  });

  it("cannot accept when capped", () => {
    const s = activateSwapMachine({ ...initialSwapState(), swapCount: MAX_SWAPS });
    expect(canAcceptSwap(s, 0)).toBe(false);
  });

  it("cannot accept during cooldown before 500ms", () => {
    const s0 = activateSwapMachine(initialSwapState());
    const s1 = commitSwapState(s0, 1000);
    expect(canAcceptSwap(s1, 1000)).toBe(false);
    expect(canAcceptSwap(s1, 1000 + COOLDOWN_MS - 1)).toBe(false);
  });

  it("can accept after cooldown expires (exactly at boundary)", () => {
    const s0 = activateSwapMachine(initialSwapState());
    const s1 = commitSwapState(s0, 1000);
    expect(canAcceptSwap(s1, 1000 + COOLDOWN_MS)).toBe(true);
    expect(canAcceptSwap(s1, 1000 + COOLDOWN_MS + 100)).toBe(true);
  });
});

describe("cooldown state machine — commit & transition", () => {
  it("commit increments swap count and enters cooldown", () => {
    const s0 = activateSwapMachine(initialSwapState());
    const s1 = commitSwapState(s0, 500);
    expect(s1.phase).toBe("cooldown");
    expect(s1.swapCount).toBe(1);
    expect(s1.cooldownStartMs).toBe(500);
  });

  it("tick during cooldown before expiry returns same phase", () => {
    const s0 = activateSwapMachine(initialSwapState());
    const s1 = commitSwapState(s0, 1000);
    const s2 = tickSwapMachine(s1, 1000 + COOLDOWN_MS - 1);
    expect(s2.phase).toBe("cooldown");
  });

  it("tick after cooldown transitions to active when under cap", () => {
    const s0 = activateSwapMachine(initialSwapState());
    const s1 = commitSwapState(s0, 1000);
    const s2 = tickSwapMachine(s1, 1000 + COOLDOWN_MS);
    expect(s2.phase).toBe("active");
  });

  it("tick after cooldown transitions to capped when swapCount >= MAX_SWAPS", () => {
    // Simulate already at cap after commit
    const s = { phase: "cooldown" as const, swapCount: MAX_SWAPS, cooldownStartMs: 0 };
    const s2 = tickSwapMachine(s, COOLDOWN_MS + 10);
    expect(s2.phase).toBe("capped");
  });

  it("tick on non-cooldown phase is a no-op", () => {
    const s = activateSwapMachine(initialSwapState());
    const s2 = tickSwapMachine(s, 99999);
    expect(s2.phase).toBe("active");
    expect(s2.swapCount).toBe(0);
  });
});

describe("swap-cap enforcement", () => {
  it("allows exactly MAX_SWAPS commits then blocks", () => {
    let state = activateSwapMachine(initialSwapState());
    let now = 0;

    for (let i = 0; i < MAX_SWAPS; i++) {
      expect(canAcceptSwap(state, now)).toBe(true);
      state = commitSwapState(state, now);
      // Advance past cooldown
      now += COOLDOWN_MS + 10;
      state = tickSwapMachine(state, now);
      now += 10;
    }

    // After MAX_SWAPS commits the machine must be capped
    expect(state.phase).toBe("capped");
    expect(state.swapCount).toBe(MAX_SWAPS);
    expect(canAcceptSwap(state, now)).toBe(false);
  });

  it("19th commit transitions to active, 20th to capped after cooldown", () => {
    let state = { phase: "active" as const, swapCount: MAX_SWAPS - 1, cooldownStartMs: 0 };
    // Commit #20
    state = commitSwapState(state, 0);
    expect(state.swapCount).toBe(MAX_SWAPS);
    expect(state.phase).toBe("cooldown");

    // After cooldown, swapCount === MAX_SWAPS → capped
    const after = tickSwapMachine(state, COOLDOWN_MS + 1);
    expect(after.phase).toBe("capped");
  });
});

describe("cooldown progress gauge", () => {
  it("progress is 0 at start of cooldown", () => {
    const s = commitSwapState(activateSwapMachine(initialSwapState()), 1000);
    expect(getCooldownProgress(s, 1000)).toBeCloseTo(0);
  });

  it("progress is 0.5 at half of cooldown", () => {
    const s = commitSwapState(activateSwapMachine(initialSwapState()), 1000);
    expect(getCooldownProgress(s, 1000 + COOLDOWN_MS / 2)).toBeCloseTo(0.5);
  });

  it("progress clamps to 1 past cooldown end", () => {
    const s = commitSwapState(activateSwapMachine(initialSwapState()), 1000);
    expect(getCooldownProgress(s, 1000 + COOLDOWN_MS)).toBeCloseTo(1);
    expect(getCooldownProgress(s, 1000 + COOLDOWN_MS * 2)).toBeCloseTo(1);
  });

  it("progress is 0 when not in cooldown", () => {
    const s = activateSwapMachine(initialSwapState());
    expect(getCooldownProgress(s, 9999)).toBe(0);
  });
});
