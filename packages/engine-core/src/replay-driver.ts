/**
 * Replay driver for Layer 3 rendering snapshot tests.
 *
 * This module provides a way to drive the renderer with pre-computed
 * physics positions, isolating rendering from physics simulation.
 */

import type { RaceSnapshot, TrackDef } from "./race-sim.js";
import type { DrawResult } from "./draw-pipeline.js";

export interface ReplayFrame {
  wheel: { x: number; y: number; angle: number };
  chassis: { x: number; y: number; angle: number };
  rearWheel: { x: number; y: number; angle: number };
  tick: number;
  elapsedMs: number;
  finished: boolean;
  dnf: boolean;
}

export interface ReplayRecording {
  track: TrackDef;
  wheelDraw: DrawResult;
  frames: ReplayFrame[];
}

/**
 * Creates a replay driver from a recording.
 * The driver provides the same interface as RaceSim for rendering,
 * but returns pre-recorded frames instead of simulating physics.
 */
export function createReplayDriver(recording: ReplayRecording) {
  let frameIndex = 0;
  const { track, wheelDraw, frames } = recording;

  return {
    get track(): TrackDef {
      return track;
    },

    get wheelDraw(): DrawResult {
      return wheelDraw;
    },

    get totalFrames(): number {
      return frames.length;
    },

    /**
     * Get a frame at a specific tick.
     * Returns the closest frame (never null).
     */
    getFrame(tick: number): ReplayFrame {
      // Find closest frame - for most cases, exact match exists
      // This is safe because we record at 60fps fixed timestep
      for (let i = frameIndex; i < frames.length; i++) {
        if (frames[i].tick === tick) {
          frameIndex = i;
          return frames[i];
        }
        if (frames[i].tick > tick) {
          // Return previous frame (closest)
          return frames[Math.max(0, i - 1)];
        }
      }
      return frames[frames.length - 1];
    },

    /**
     * Step through the recording like a simulation.
     * Returns null when recording ends.
     */
    step(): RaceSnapshot | null {
      if (frameIndex >= frames.length) {
        return null;
      }
      const frame = frames[frameIndex++];
      return {
        wheel: frame.wheel,
        chassis: frame.chassis,
        rearWheel: frame.rearWheel,
        tick: frame.tick,
        elapsedMs: frame.elapsedMs,
        finished: frame.finished,
        dnf: frame.dnf,
      };
    },

    /**
     * Reset replay to beginning.
     */
    reset(): void {
      frameIndex = 0;
    },

    /**
     * Get all frames for a specific tick range.
     * Useful for batch snapshot testing.
     */
    getFramesAtTicks(ticks: number[]): ReplayFrame[] {
      return ticks.map((t) => getFrameAtTick(frames, t));
    },
  };
}

function getFrameAtTick(frames: ReplayFrame[], tick: number): ReplayFrame {
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].tick >= tick) {
      return frames[i];
    }
  }
  return frames[frames.length - 1];
}

/**
 * Record a RaceSim into a ReplayRecording.
 * Call this during test setup to create test fixtures.
 */
export async function recordRaceSim(
  sim: { step(): RaceSnapshot; isFinished(): boolean; getElapsedMs(): number },
  track: TrackDef,
  wheelDraw: DrawResult,
  maxTicks: number = 60 * 180
): Promise<ReplayRecording> {
  const frames: ReplayFrame[] = [];

  while (!sim.isFinished() && frames.length < maxTicks) {
    const snap = sim.step();
    frames.push({
      wheel: { ...snap.wheel },
      chassis: { ...snap.chassis },
      rearWheel: { ...snap.rearWheel },
      tick: snap.tick,
      elapsedMs: snap.elapsedMs,
      finished: snap.finished,
      dnf: snap.dnf,
    });
  }

  return {
    track,
    wheelDraw,
    frames,
  };
}

/**
 * Deterministic snapshot ticks for testing.
 * These capture key moments: start, early race, mid race, late race, finish.
 */
export const SNAPSHOT_TICKS = [0, 30, 120, 300] as const;

/**
 * Extract a minimal recording containing only frames at snapshot ticks.
 * Used to reduce fixture file size.
 */
export function extractSnapshotFrames(
  recording: ReplayRecording,
  ticks: number[] = [...SNAPSHOT_TICKS]
): ReplayRecording {
  const frames = recording.frames;
  const snapshotFrames = ticks.map((t) => getFrameAtTick(frames, t));

  return {
    track: recording.track,
    wheelDraw: recording.wheelDraw,
    frames: snapshotFrames,
  };
}
