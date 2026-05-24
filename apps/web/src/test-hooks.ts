/**
 * Production-safe test hooks for deterministic behavior.
 *
 * These hooks are enabled via URL query parameters and are designed to be
 * safe in production (they don't expose sensitive data or break normal flows).
 *
 * Supported parameters:
 * - ?seed=N - Uses a deterministic RNG seed instead of random values
 * - ?track=v1 - Uses track variant v1 (for track A/B testing)
 */

const params = new URLSearchParams(window.location.search);

/**
 * Get the deterministic seed from URL params.
 * Returns undefined if no seed is specified (normal random behavior).
 */
export function getTestSeed(): number | undefined {
  const seedStr = params.get("seed");
  if (seedStr === null) return undefined;
  const seed = parseInt(seedStr, 10);
  return isNaN(seed) ? undefined : seed;
}

/**
 * Get the track variant from URL params.
 * Returns undefined if no variant is specified.
 */
export function getTestTrackVariant(): string | undefined {
  const track = params.get("track");
  return track ?? undefined;
}

/**
 * Check if deterministic test mode is active (seed is set).
 */
export function isDeterministicTestMode(): boolean {
  return getTestSeed() !== undefined;
}

/**
 * Deterministic clock for testing.
 * When ?seed is present, returns deterministic times starting from a fixed offset.
 * Otherwise returns the actual current time.
 */
export function getDeterministicNow(): number {
  if (isDeterministicTestMode()) {
    // In deterministic mode, use a fixed base time
    // The caller is responsible for advancing time if needed
    return 1000000; // Fixed base time in ms
  }
  return Date.now();
}

/**
 * Deterministic performance.now() for testing.
 * When ?seed is present, returns deterministic high-resolution times.
 */
export function getDeterministicPerformanceNow(): number {
  if (isDeterministicTestMode()) {
    // In deterministic mode, use a fixed base time
    return 1000.0; // Fixed base time in ms
  }
  return typeof performance !== "undefined" ? performance.now() : 0;
}
