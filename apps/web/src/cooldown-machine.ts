export const MAX_SWAPS = 20;
export const COOLDOWN_MS = 500;

export type SwapPhase = "inactive" | "active" | "cooldown" | "capped";

export interface SwapMachineState {
  phase: SwapPhase;
  swapCount: number;
  cooldownStartMs: number;
}

export function initialSwapState(): SwapMachineState {
  return { phase: "inactive", swapCount: 0, cooldownStartMs: 0 };
}

export function activateSwapMachine(state: SwapMachineState): SwapMachineState {
  if (state.phase !== "inactive") return state;
  return {
    ...state,
    phase: state.swapCount >= MAX_SWAPS ? "capped" : "active",
  };
}

export function deactivateSwapMachine(state: SwapMachineState): SwapMachineState {
  return { ...state, phase: "inactive" };
}

export function canAcceptSwap(state: SwapMachineState, nowMs: number): boolean {
  if (state.phase === "inactive" || state.phase === "capped") return false;
  if (state.phase === "cooldown") {
    return nowMs - state.cooldownStartMs >= COOLDOWN_MS;
  }
  return true;
}

export function commitSwapState(state: SwapMachineState, nowMs: number): SwapMachineState {
  const newCount = state.swapCount + 1;
  return {
    phase: "cooldown",
    swapCount: newCount,
    cooldownStartMs: nowMs,
  };
}

export function tickSwapMachine(state: SwapMachineState, nowMs: number): SwapMachineState {
  if (state.phase !== "cooldown") return state;
  if (nowMs - state.cooldownStartMs >= COOLDOWN_MS) {
    return {
      ...state,
      phase: state.swapCount >= MAX_SWAPS ? "capped" : "active",
    };
  }
  return state;
}

export function getCooldownProgress(state: SwapMachineState, nowMs: number): number {
  if (state.phase !== "cooldown") return 0;
  return Math.min((nowMs - state.cooldownStartMs) / COOLDOWN_MS, 1);
}
