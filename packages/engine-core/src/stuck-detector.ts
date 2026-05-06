/**
 * Stuck-DNF detector.
 *
 * Detects when the vehicle spins through 10 full rotations without advancing
 * the chassis by more than 0.5 metres along +x. This catches flipped/wedged
 * cars or pathological wheel shapes that spin in place.
 *
 * Deterministic: uses tick-indexed accumulation with fixed dt (1/60 s).
 */

const DT = 1 / 60;
const ROTATION_THRESHOLD = 10; // full rotations
const PROGRESS_THRESHOLD_METRES = 0.5; // metres along +x

export type StuckResult = "running" | "stuck";

export class StuckDetector {
  private rotations = 0;
  private baselineX = 0;

  /**
   * Reset the detector (called on race start and on wheel swap).
   */
  reset(): void {
    this.rotations = 0;
    this.baselineX = 0;
  }

  /**
   * Set the initial baseline X position (call once after spawning the chassis).
   */
  setBaseline(x: number): void {
    this.baselineX = x;
  }

  /**
   * Update the detector with current physics state.
   *
   * @param frontAngVel - Front wheel angular velocity (rad/s)
   * @param rearAngVel - Rear wheel angular velocity (rad/s)
   * @param chassisX - Current chassis X position (metres)
   * @returns "stuck" if DNF should trigger, "running" otherwise
   */
  tick(frontAngVel: number, rearAngVel: number, chassisX: number): StuckResult {
    // Accumulate rotations: (|ω_front| + |ω_rear|) * dt / (2π * 2)
    // The /2 halves the both-wheel sum so one "whole car rotation" is one, not two.
    const rotationIncrement =
      (Math.abs(frontAngVel) + Math.abs(rearAngVel)) * DT / (2 * Math.PI * 2);
    this.rotations += rotationIncrement;

    const deltaX = chassisX - this.baselineX;

    // If we've made sufficient progress, reset the counter and grant a fresh window.
    if (deltaX >= PROGRESS_THRESHOLD_METRES) {
      this.rotations = 0;
      this.baselineX = chassisX;
      return "running";
    }

    // Check if we've hit the rotation threshold without enough progress.
    if (this.rotations >= ROTATION_THRESHOLD) {
      return "stuck";
    }

    return "running";
  }

  /**
   * Get the current accumulated rotation count (for testing/debugging).
   */
  getRotations(): number {
    return this.rotations;
  }

  /**
   * Get the current baseline X position (for testing/debugging).
   */
  getBaselineX(): number {
    return this.baselineX;
  }
}
