/**
 * Player progression system
 * Tracks total distance raced and unlockable cosmetic wheel trails
 */

const PROGRESSION_KEY = "drawrace.progression";

export interface TrailConfig {
  id: string;
  name: string;
  description: string;
  unlockDistanceMeters: number;
  color: string;
  particleCount: number;
  particleLifetime: number; // frames
  spread: number;
  drift: number;
}

/**
 * All available wheel trails, ordered by unlock distance
 */
export const TRAILS: TrailConfig[] = [
  {
    id: "none",
    name: "No Trail",
    description: "Clean wheels, no trail",
    unlockDistanceMeters: 0,
    color: "transparent",
    particleCount: 0,
    particleLifetime: 0,
    spread: 0,
    drift: 0,
  },
  {
    id: "dust",
    name: "Dust Cloud",
    description: "A gentle dust cloud kicks up from your wheels",
    unlockDistanceMeters: 500,
    color: "rgba(229, 211, 176, 0.4)", // #E5D3B0 - warm earth tone
    particleCount: 2,
    particleLifetime: 30,
    spread: 0.3,
    drift: 0.1,
  },
  {
    id: "ember",
    name: "Ember Sparks",
    description: "Orange sparks fly from your wheels",
    unlockDistanceMeters: 2000,
    color: "rgba(217, 79, 58, 0.6)", // #D94F3A - racer red
    particleCount: 3,
    particleLifetime: 25,
    spread: 0.4,
    drift: 0.15,
  },
  {
    id: "magic",
    name: "Magic Dust",
    description: "Sparkles trail behind your wheels",
    unlockDistanceMeters: 5000,
    color: "rgba(111, 168, 201, 0.5)", // #6FA8C9 - soft blue
    particleCount: 4,
    particleLifetime: 40,
    spread: 0.5,
    drift: 0.2,
  },
  {
    id: "rainbow",
    name: "Rainbow Trail",
    description: "A vibrant rainbow follows your wheels",
    unlockDistanceMeters: 10000,
    color: "rainbow",
    particleCount: 5,
    particleLifetime: 35,
    spread: 0.6,
    drift: 0.25,
  },
  {
    id: "void",
    name: "Void Walker",
    description: "Dark energy emanates from your wheels",
    unlockDistanceMeters: 25000,
    color: "rgba(43, 33, 24, 0.5)", // #2B2118 - warm-black ink
    particleCount: 6,
    particleLifetime: 45,
    spread: 0.7,
    drift: 0.3,
  },
];

export interface ProgressionData {
  totalDistanceMeters: number;
  selectedTrailId: string;
}

const DEFAULT_PROGRESSION: ProgressionData = {
  totalDistanceMeters: 0,
  selectedTrailId: "none",
};

/**
 * Get progression data from localStorage
 */
export function getProgression(): ProgressionData {
  try {
    const saved = localStorage.getItem(PROGRESSION_KEY);
    if (saved) {
      return { ...DEFAULT_PROGRESSION, ...JSON.parse(saved) };
    }
  } catch {
    // Storage unavailable, return default
  }
  return { ...DEFAULT_PROGRESSION };
}

/**
 * Save progression data to localStorage
 */
export function saveProgression(data: ProgressionData): void {
  try {
    localStorage.setItem(PROGRESSION_KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable, silently fail
  }
}

/**
 * Add distance to total and save
 */
export function addDistance(distanceMeters: number): ProgressionData {
  const current = getProgression();
  const updated: ProgressionData = {
    ...current,
    totalDistanceMeters: current.totalDistanceMeters + distanceMeters,
  };
  saveProgression(updated);
  return updated;
}

/**
 * Get the trail config for a given trail ID
 */
export function getTrailConfig(trailId: string): TrailConfig {
  return TRAILS.find((t) => t.id === trailId) || TRAILS[0];
}

/**
 * Get all unlocked trails for the current player
 */
export function getUnlockedTrails(): TrailConfig[] {
  const progression = getProgression();
  return TRAILS.filter(
    (t) => t.unlockDistanceMeters <= progression.totalDistanceMeters
  );
}

/**
 * Check if a specific trail is unlocked
 */
export function isTrailUnlocked(trailId: string): boolean {
  const progression = getProgression();
  const trail = getTrailConfig(trailId);
  return trail.unlockDistanceMeters <= progression.totalDistanceMeters;
}

/**
 * Get the currently selected trail config
 */
export function getSelectedTrail(): TrailConfig {
  const progression = getProgression();
  return getTrailConfig(progression.selectedTrailId);
}

/**
 * Set the selected trail (only if unlocked)
 */
export function setSelectedTrail(trailId: string): boolean {
  if (!isTrailUnlocked(trailId)) {
    return false;
  }
  const current = getProgression();
  saveProgression({ ...current, selectedTrailId: trailId });
  return true;
}

/**
 * Get progress toward next trail unlock
 * Returns { currentTrail, nextTrail, progressFraction }
 */
export function getNextTrailUnlock(): {
  currentTrail: TrailConfig;
  nextTrail: TrailConfig | null;
  progressFraction: number;
} {
  const progression = getProgression();
  const unlocked = getUnlockedTrails();
  const currentTrail = unlocked[unlocked.length - 1] || TRAILS[0];

  const nextTrail = TRAILS.find((t) => t.unlockDistanceMeters > progression.totalDistanceMeters);

  if (!nextTrail) {
    return {
      currentTrail,
      nextTrail: null,
      progressFraction: 1,
    };
  }

  const prevUnlockMeters = currentTrail.unlockDistanceMeters;
  const nextUnlockMeters = nextTrail.unlockDistanceMeters;
  const progressFraction =
    (progression.totalDistanceMeters - prevUnlockMeters) /
    (nextUnlockMeters - prevUnlockMeters);

  return {
    currentTrail,
    nextTrail,
    progressFraction: Math.min(1, Math.max(0, progressFraction)),
  };
}

/**
 * Reset progression (for testing only)
 */
export function _resetProgression(): void {
  try {
    localStorage.removeItem(PROGRESSION_KEY);
  } catch {
    // Storage unavailable
  }
}
