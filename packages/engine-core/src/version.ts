// v9 (drawrace-0238e6da): radius-compensated wheel motor targets —
// motorSpeedForRadius equalizes wheel linear top speed (v = ω·R_mean) so wheel
// SHAPE differentiates via geometry instead of raw top speed.
export const PHYSICS_VERSION = 9;

/** Version at which mid-race wheel swaps were introduced (wheels[] binary layout). */
export const PHYSICS_VERSION_WITH_SWAPS = 2;
