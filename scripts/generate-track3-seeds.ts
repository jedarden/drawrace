#!/usr/bin/env ts-node
/**
 * Generate 30 seed ghost blob files for track 3 (dunes-03).
 *
 * Track 3: Dune Drifter
 * - 48m long (longest of the three tracks)
 * - Target time: 55s
 * - Zones: A(normal) → B(water+dune) → C(rock+ramp) → D(ice+obstacles) → E(snow finish)
 *
 * Bucket distribution (percent_rank over ordered times):
 * - elite    (pr ≤ 0.01):  1 ghost
 * - advanced (pr ≤ 0.05):  1 ghost
 * - skilled  (pr ≤ 0.20):  5 ghosts
 * - mid      (pr ≤ 0.50):  8 ghosts
 * - novice   (pr >  0.50): 15 ghosts
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { encodeGhostBlob } from '../apps/web/src/ghost-blob';
import { PHYSICS_VERSION } from '../packages/engine-core/src/version';

const TRACK_ID = 3;
const SEED_DIR = 'seeds/track_3';

interface SeedGhost {
    name: string;
    time_ms: number;
    wheels: Array<{ swapTick: number; vertices: Array<{ x: number; y: number }> }>;
}

// Helper to create wheel vertices from coordinate pairs
function createVertices(coords: number[][], scale: number = 1.0): Array<{ x: number; y: number }> {
    return coords.map(([x, y]) => ({ x: x * scale, y: y * scale }));
}

/**
 * 30 seed ghosts with varied wheel shapes and times spanning all buckets.
 * Times adjusted for dunes-03 (48m, target 55s):
 * - Elite: ~39s (extremely fast, perfect wheel)
 * - Advanced: ~46s (very fast, optimal swaps)
 * - Skilled: ~51-57s (good times, some swaps)
 * - Mid: ~59-73s (average runs, mixed performance)
 * - Novice: ~76-102s (slower runs, suboptimal wheels)
 */
const SEEDS: SeedGhost[] = [
    // Elite (1 ghost) - near-perfect circle, excellent time
    {
        name: "SaharaStorm",
        time_ms: 39_200,
        wheels: [{ swapTick: 0, vertices: createVertices([
            [0.48, 0.0], [0.44, 0.19], [0.34, 0.34], [0.19, 0.44], [0.0, 0.48],
            [-0.19, 0.44], [-0.34, 0.34], [-0.44, 0.19], [-0.48, 0.0], [-0.44, -0.19],
            [-0.34, -0.34], [-0.19, -0.44], [0.0, -0.48], [0.19, -0.44], [0.34, -0.34],
            [0.44, -0.19]
        ], 1.1) }]
    },
    // Advanced (1 ghost) - larger circle with strategic swap
    {
        name: "DuneMaster",
        time_ms: 45_800,
        wheels: [
            { swapTick: 0, vertices: createVertices([
                [0.52, 0.0], [0.48, 0.20], [0.37, 0.37], [0.20, 0.48], [0.0, 0.52],
                [-0.20, 0.48], [-0.37, 0.37], [-0.48, 0.20], [-0.52, 0.0], [-0.48, -0.20],
                [-0.37, -0.37], [-0.20, -0.48], [0.0, -0.52], [0.20, -0.48], [0.37, -0.37],
                [0.48, -0.20]
            ], 1.15) },
            { swapTick: 1200, vertices: createVertices([ // Swap at 20s for rock ramp
                [0.55, 0.0], [0.51, 0.22], [0.38, 0.38], [0.22, 0.51], [0.0, 0.55],
                [-0.22, 0.51], [-0.38, 0.38], [-0.51, 0.22], [-0.55, 0.0], [-0.51, -0.22],
                [-0.38, -0.38], [-0.22, -0.51], [0.0, -0.55], [0.22, -0.51], [0.38, -0.38],
                [0.51, -0.22]
            ], 1.05) }
        ]
    },
    // Skilled (5 ghosts) - good performance with various wheel shapes
    {
        name: "CanyonCarver",
        time_ms: 50_500,
        wheels: [{ swapTick: 0, vertices: createVertices([
            [0.50, 0.0], [0.46, 0.19], [0.35, 0.35], [0.19, 0.46], [0.0, 0.50],
            [-0.19, 0.46], [-0.35, 0.35], [-0.46, 0.19], [-0.50, 0.0], [-0.46, -0.19],
            [-0.35, -0.35], [-0.19, -0.46], [0.0, -0.50], [0.19, -0.46], [0.35, -0.35],
            [0.46, -0.19]
        ], 1.0) }]
    },
    {
        name: "SandSurfer",
        time_ms: 52_300,
        wheels: [
            { swapTick: 0, vertices: createVertices([
                [0.54, 0.0], [0.50, 0.21], [0.38, 0.38], [0.21, 0.50], [0.0, 0.54],
                [-0.21, 0.50], [-0.38, 0.38], [-0.50, 0.21], [-0.54, 0.0], [-0.50, -0.21],
                [-0.38, -0.38], [-0.21, -0.50], [0.0, -0.54], [0.21, -0.50], [0.38, -0.38],
                [0.50, -0.21]
            ], 1.0) },
            { swapTick: 1500, vertices: createVertices([
                [0.58, 0.0], [0.53, 0.24], [0.40, 0.40], [0.24, 0.53], [0.0, 0.58],
                [-0.24, 0.53], [-0.40, 0.40], [-0.53, 0.24], [-0.58, 0.0], [-0.53, -0.24],
                [-0.40, -0.40], [-0.24, -0.53], [0.0, -0.58], [0.24, -0.53], [0.40, -0.40],
                [0.53, -0.24]
            ], 0.9) }
        ]
    },
    {
        name: "DesertDash",
        time_ms: 54_100,
        wheels: [{ swapTick: 0, vertices: createVertices([
            [0.56, 0.0], [0.48, 0.28], [0.28, 0.48], [0.0, 0.56],
            [-0.28, 0.48], [-0.48, 0.28], [-0.56, 0.0], [-0.48, -0.28],
            [-0.28, -0.48], [0.0, -0.56], [0.28, -0.48], [0.48, -0.28]
        ], 1.05) }]
    },
    {
        name: "MirageRacer",
        time_ms: 55_800,
        wheels: [
            { swapTick: 0, vertices: createVertices([
                [0.51, 0.0], [0.47, 0.18], [0.36, 0.36], [0.18, 0.47], [0.0, 0.51],
                [-0.18, 0.47], [-0.36, 0.36], [-0.47, 0.18], [-0.51, 0.0], [-0.47, -0.18],
                [-0.36, -0.36], [-0.18, -0.47], [0.0, -0.51], [0.18, -0.47], [0.36, -0.36],
                [0.47, -0.18]
            ], 0.95) },
            { swapTick: 1800, vertices: createVertices([
                [0.53, 0.0], [0.49, 0.20], [0.37, 0.37], [0.20, 0.49], [0.0, 0.53],
                [-0.20, 0.49], [-0.37, 0.37], [-0.49, 0.20], [-0.53, 0.0], [-0.49, -0.20],
                [-0.37, -0.37], [-0.20, -0.49], [0.0, -0.53], [0.20, -0.49], [0.37, -0.37],
                [0.49, -0.20]
            ], 1.0) }
        ]
    },
    {
        name: "OasisRunner",
        time_ms: 56_900,
        wheels: [{ swapTick: 0, vertices: createVertices([
            [0.60, 0.0], [0.55, 0.30], [0.30, 0.55], [0.0, 0.60],
            [-0.30, 0.55], [-0.55, 0.30], [-0.60, 0.0], [-0.55, -0.30],
            [-0.30, -0.55], [0.0, -0.60], [0.30, -0.55], [0.55, -0.30]
        ], 1.0) }]
    },
    // Mid (8 ghosts) - average performance
    {
        name: "SandStrider",
        time_ms: 59_200,
        wheels: [{ swapTick: 0, vertices: createVertices([
            [0.47, 0.0], [0.43, 0.18], [0.33, 0.33], [0.18, 0.43], [0.0, 0.47],
            [-0.18, 0.43], [-0.33, 0.33], [-0.43, 0.18], [-0.47, 0.0], [-0.43, -0.18],
            [-0.33, -0.33], [-0.18, -0.43], [0.0, -0.47], [0.18, -0.43], [0.33, -0.33],
            [0.43, -0.18]
        ], 0.9) }]
    },
    {
        name: "DuneDasher",
        time_ms: 61_500,
        wheels: [
            { swapTick: 0, vertices: createVertices([
                [0.49, 0.0], [0.45, 0.17], [0.34, 0.34], [0.17, 0.45], [0.0, 0.49],
                [-0.17, 0.45], [-0.34, 0.34], [-0.45, 0.17], [-0.49, 0.0], [-0.45, -0.17],
                [-0.34, -0.34], [-0.17, -0.45], [0.0, -0.49], [0.17, -0.45], [0.34, -0.34],
                [0.45, -0.17]
            ], 0.9) },
            { swapTick: 2000, vertices: createVertices([
                [0.52, 0.0], [0.48, 0.19], [0.36, 0.36], [0.19, 0.48], [0.0, 0.52],
                [-0.19, 0.48], [-0.36, 0.36], [-0.48, 0.19], [-0.52, 0.0], [-0.48, -0.19],
                [-0.36, -0.36], [-0.19, -0.48], [0.0, -0.52], [0.19, -0.48], [0.36, -0.36],
                [0.48, -0.19]
            ], 0.95) }
        ]
    },
    {
        name: "DesertDrifter",
        time_ms: 63_800,
        wheels: [{ swapTick: 0, vertices: createVertices([
            [0.53, 0.0], [0.42, 0.32], [0.32, 0.42], [0.0, 0.53],
            [-0.32, 0.42], [-0.42, 0.32], [-0.53, 0.0], [-0.42, -0.32],
            [-0.32, -0.42], [0.0, -0.53], [0.32, -0.42], [0.42, -0.32]
        ], 0.85) }]
    },
    {
        name: "SaharaSeeker",
        time_ms: 65_400,
        wheels: [
            { swapTick: 0, vertices: createVertices([
                [0.46, 0.0], [0.42, 0.16], [0.32, 0.32], [0.16, 0.42], [0.0, 0.46],
                [-0.16, 0.42], [-0.32, 0.32], [-0.42, 0.16], [-0.46, 0.0], [-0.42, -0.16],
                [-0.32, -0.32], [-0.16, -0.42], [0.0, -0.46], [0.16, -0.42], [0.32, -0.32],
                [0.42, -0.16]
            ], 0.85) },
            { swapTick: 2400, vertices: createVertices([
                [0.50, 0.0], [0.46, 0.18], [0.34, 0.34], [0.18, 0.46], [0.0, 0.50],
                [-0.18, 0.46], [-0.34, 0.34], [-0.46, 0.18], [-0.50, 0.0], [-0.46, -0.18],
                [-0.34, -0.34], [-0.18, -0.46], [0.0, -0.50], [0.18, -0.46], [0.34, -0.34],
                [0.46, -0.18]
            ], 0.9) }
        ]
    },
    {
        name: "SandSprinter",
        time_ms: 67_100,
        wheels: [{ swapTick: 0, vertices: createVertices([
            [0.55, 0.0], [0.48, 0.28], [0.28, 0.48], [0.0, 0.55],
            [-0.28, 0.48], [-0.48, 0.28], [-0.55, 0.0], [-0.48, -0.28],
            [-0.28, -0.48], [0.0, -0.55], [0.28, -0.48], [0.48, -0.28]
        ], 0.85) }]
    },
    {
        name: "DuneDuster",
        time_ms: 68_900,
        wheels: [
            { swapTick: 0, vertices: createVertices([
                [0.44, 0.0], [0.40, 0.15], [0.30, 0.30], [0.15, 0.40], [0.0, 0.44],
                [-0.15, 0.40], [-0.30, 0.30], [-0.40, 0.15], [-0.44, 0.0], [-0.40, -0.15],
                [-0.30, -0.30], [-0.15, -0.40], [0.0, -0.44], [0.15, -0.40], [0.30, -0.30],
                [0.40, -0.15]
            ], 0.8) },
            { swapTick: 2700, vertices: createVertices([
                [0.48, 0.0], [0.44, 0.17], [0.32, 0.32], [0.17, 0.44], [0.0, 0.48],
                [-0.17, 0.44], [-0.32, 0.32], [-0.44, 0.17], [-0.48, 0.0], [-0.44, -0.17],
                [-0.32, -0.32], [-0.17, -0.44], [0.0, -0.48], [0.17, -0.44], [0.32, -0.32],
                [0.44, -0.17]
            ], 0.85) }
        ]
    },
    {
        name: "MirageChaser",
        time_ms: 70_200,
        wheels: [{ swapTick: 0, vertices: createVertices([
            [0.58, 0.0], [0.50, 0.30], [0.30, 0.50], [0.0, 0.58],
            [-0.30, 0.50], [-0.50, 0.30], [-0.58, 0.0], [-0.50, -0.30],
            [-0.30, -0.50], [0.0, -0.58], [0.30, -0.50], [0.50, -0.30]
        ], 0.8) }]
    },
    {
        name: "SandScout",
        time_ms: 72_500,
        wheels: [
            { swapTick: 0, vertices: createVertices([
                [0.43, 0.0], [0.39, 0.14], [0.29, 0.29], [0.14, 0.39], [0.0, 0.43],
                [-0.14, 0.39], [-0.29, 0.29], [-0.39, 0.14], [-0.43, 0.0], [-0.39, -0.14],
                [-0.29, -0.29], [-0.14, -0.39], [0.0, -0.43], [0.14, -0.39], [0.29, -0.29],
                [0.39, -0.14]
            ], 0.75) },
            { swapTick: 3000, vertices: createVertices([
                [0.47, 0.0], [0.43, 0.16], [0.31, 0.31], [0.16, 0.43], [0.0, 0.47],
                [-0.16, 0.43], [-0.31, 0.31], [-0.43, 0.16], [-0.47, 0.0], [-0.43, -0.16],
                [-0.31, -0.31], [-0.16, -0.43], [0.0, -0.47], [0.16, -0.43], [0.31, -0.31],
                [0.43, -0.16]
            ], 0.8) }
        ]
    },
    // Novice (15 ghosts) - slower runs, various wheel shapes
    {
        name: "Wanderer",
        time_ms: 75_800,
        wheels: [{ swapTick: 0, vertices: createVertices([
            [0.42, 0.0], [0.38, 0.12], [0.28, 0.28], [0.12, 0.38], [0.0, 0.42],
            [-0.12, 0.38], [-0.28, 0.28], [-0.38, 0.12], [-0.42, 0.0], [-0.38, -0.12],
            [-0.28, -0.28], [-0.12, -0.38], [0.0, -0.42], [0.12, -0.38], [0.28, -0.28],
            [0.38, -0.12]
        ], 0.7) }]
    },
    {
        name: "DuneWalker",
        time_ms: 78_200,
        wheels: [
            { swapTick: 0, vertices: createVertices([
                [0.41, 0.0], [0.37, 0.10], [0.27, 0.27], [0.10, 0.37], [0.0, 0.41],
                [-0.10, 0.37], [-0.27, 0.27], [-0.37, 0.10], [-0.41, 0.0], [-0.37, -0.10],
                [-0.27, -0.27], [-0.10, -0.37], [0.0, -0.41], [0.10, -0.37], [0.27, -0.27],
                [0.37, -0.10]
            ], 0.65) },
            { swapTick: 3600, vertices: createVertices([
                [0.45, 0.0], [0.41, 0.14], [0.30, 0.30], [0.14, 0.41], [0.0, 0.45],
                [-0.14, 0.41], [-0.30, 0.30], [-0.41, 0.14], [-0.45, 0.0], [-0.41, -0.14],
                [-0.30, -0.30], [-0.14, -0.41], [0.0, -0.45], [0.14, -0.41], [0.30, -0.30],
                [0.41, -0.14]
            ], 0.7) }
        ]
    },
    {
        name: "SandTrudger",
        time_ms: 80_500,
        wheels: [{ swapTick: 0, vertices: createVertices([
            [0.50, 0.0], [0.40, 0.30], [0.30, 0.40], [0.0, 0.50],
            [-0.30, 0.40], [-0.40, 0.30], [-0.50, 0.0], [-0.40, -0.30],
            [-0.30, -0.40], [0.0, -0.50], [0.30, -0.40], [0.40, -0.30]
        ], 0.65) }]
    },
    {
        name: "DesertPlodder",
        time_ms: 82_900,
        wheels: [
            { swapTick: 0, vertices: createVertices([
                [0.40, 0.0], [0.35, 0.12], [0.25, 0.25], [0.12, 0.35], [0.0, 0.40],
                [-0.12, 0.35], [-0.25, 0.25], [-0.35, 0.12], [-0.40, 0.0], [-0.35, -0.12],
                [-0.25, -0.25], [-0.12, -0.35], [0.0, -0.40], [0.12, -0.35], [0.25, -0.25],
                [0.35, -0.12]
            ], 0.6) },
            { swapTick: 4200, vertices: createVertices([
                [0.44, 0.0], [0.39, 0.13], [0.28, 0.28], [0.13, 0.39], [0.0, 0.44],
                [-0.13, 0.39], [-0.28, 0.28], [-0.39, 0.13], [-0.44, 0.0], [-0.39, -0.13],
                [-0.28, -0.28], [-0.13, -0.39], [0.0, -0.44], [0.13, -0.39], [0.28, -0.28],
                [0.39, -0.13]
            ], 0.65) }
        ]
    },
    {
        name: "SaharaStraggler",
        time_ms: 85_100,
        wheels: [{ swapTick: 0, vertices: createVertices([
            [0.45, 0.0], [0.38, 0.25], [0.25, 0.38], [0.0, 0.45],
            [-0.25, 0.38], [-0.38, 0.25], [-0.45, 0.0], [-0.38, -0.25],
            [-0.25, -0.38], [0.0, -0.45], [0.25, -0.38], [0.38, -0.25]
        ], 0.6) }]
    },
    {
        name: "DuneDragger",
        time_ms: 87_600,
        wheels: [
            { swapTick: 0, vertices: createVertices([
                [0.39, 0.0], [0.34, 0.10], [0.24, 0.24], [0.10, 0.34], [0.0, 0.39],
                [-0.10, 0.34], [-0.24, 0.24], [-0.34, 0.10], [-0.39, 0.0], [-0.34, -0.10],
                [-0.24, -0.24], [-0.10, -0.34], [0.0, -0.39], [0.10, -0.34], [0.24, -0.24],
                [0.34, -0.10]
            ], 0.55) },
            { swapTick: 4800, vertices: createVertices([
                [0.43, 0.0], [0.38, 0.12], [0.27, 0.27], [0.12, 0.38], [0.0, 0.43],
                [-0.12, 0.38], [-0.27, 0.27], [-0.38, 0.12], [-0.43, 0.0], [-0.38, -0.12],
                [-0.27, -0.27], [-0.12, -0.38], [0.0, -0.43], [0.12, -0.38], [0.27, -0.27],
                [0.38, -0.12]
            ], 0.6) }
        ]
    },
    {
        name: "SandSlogger",
        time_ms: 89_800,
        wheels: [{ swapTick: 0, vertices: createVertices([
            [0.48, 0.0], [0.42, 0.24], [0.24, 0.42], [0.0, 0.48],
            [-0.24, 0.42], [-0.42, 0.24], [-0.48, 0.0], [-0.42, -0.24],
            [-0.24, -0.42], [0.0, -0.48], [0.24, -0.42], [0.42, -0.24]
        ], 0.55) }]
    },
    {
        name: "MirageLag",
        time_ms: 91_500,
        wheels: [
            { swapTick: 0, vertices: createVertices([
                [0.38, 0.0], [0.32, 0.08], [0.22, 0.22], [0.08, 0.32], [0.0, 0.38],
                [-0.08, 0.32], [-0.22, 0.22], [-0.32, 0.08], [-0.38, 0.0], [-0.32, -0.08],
                [-0.22, -0.22], [-0.08, -0.32], [0.0, -0.38], [0.08, -0.32], [0.22, -0.22],
                [0.32, -0.08]
            ], 0.5) },
            { swapTick: 5400, vertices: createVertices([
                [0.42, 0.0], [0.37, 0.11], [0.26, 0.26], [0.11, 0.37], [0.0, 0.42],
                [-0.11, 0.37], [-0.26, 0.26], [-0.37, 0.11], [-0.42, 0.0], [-0.37, -0.11],
                [-0.26, -0.26], [-0.11, -0.37], [0.0, -0.42], [0.11, -0.37], [0.26, -0.26],
                [0.37, -0.11]
            ], 0.55) }
        ]
    },
    {
        name: "DesertLag",
        time_ms: 93_200,
        wheels: [{ swapTick: 0, vertices: createVertices([
            [0.44, 0.0], [0.36, 0.26], [0.26, 0.36], [0.0, 0.44],
            [-0.26, 0.36], [-0.36, 0.26], [-0.44, 0.0], [-0.36, -0.26],
            [-0.26, -0.36], [0.0, -0.44], [0.26, -0.36], [0.36, -0.26]
        ], 0.5) }]
    },
    {
        name: "OasisLagger",
        time_ms: 95_700,
        wheels: [
            { swapTick: 0, vertices: createVertices([
                [0.37, 0.0], [0.30, 0.10], [0.20, 0.20], [0.10, 0.30], [0.0, 0.37],
                [-0.10, 0.30], [-0.20, 0.20], [-0.30, 0.10], [-0.37, 0.0], [-0.30, -0.10],
                [-0.20, -0.20], [-0.10, -0.30], [0.0, -0.37], [0.10, -0.30], [0.20, -0.20],
                [0.30, -0.10]
            ], 0.45) },
            { swapTick: 6000, vertices: createVertices([
                [0.41, 0.0], [0.35, 0.12], [0.24, 0.24], [0.12, 0.35], [0.0, 0.41],
                [-0.12, 0.35], [-0.24, 0.24], [-0.35, 0.12], [-0.41, 0.0], [-0.35, -0.12],
                [-0.24, -0.24], [-0.12, -0.35], [0.0, -0.41], [0.12, -0.35], [0.24, -0.24],
                [0.35, -0.12]
            ], 0.5) }
        ]
    },
    {
        name: "SandSnail",
        time_ms: 97_900,
        wheels: [{ swapTick: 0, vertices: createVertices([
            [0.43, 0.0], [0.34, 0.28], [0.28, 0.34], [0.0, 0.43],
            [-0.28, 0.34], [-0.34, 0.28], [-0.43, 0.0], [-0.34, -0.28],
            [-0.28, -0.34], [0.0, -0.43], [0.28, -0.34], [0.34, -0.28]
        ], 0.45) }]
    },
    {
        name: "DuneDawdler",
        time_ms: 99_800,
        wheels: [
            { swapTick: 0, vertices: createVertices([
                [0.36, 0.0], [0.28, 0.12], [0.18, 0.18], [0.12, 0.28], [0.0, 0.36],
                [-0.12, 0.28], [-0.18, 0.18], [-0.28, 0.12], [-0.36, 0.0], [-0.28, -0.12],
                [-0.18, -0.18], [-0.12, -0.28], [0.0, -0.36], [0.12, -0.28], [0.18, -0.18],
                [0.28, -0.12]
            ], 0.4) },
            { swapTick: 6600, vertices: createVertices([
                [0.40, 0.0], [0.33, 0.11], [0.22, 0.22], [0.11, 0.33], [0.0, 0.40],
                [-0.11, 0.33], [-0.22, 0.22], [-0.33, 0.11], [-0.40, 0.0], [-0.33, -0.11],
                [-0.22, -0.22], [-0.11, -0.33], [0.0, -0.40], [0.11, -0.33], [0.22, -0.22],
                [0.33, -0.11]
            ], 0.45) }
        ]
    },
    {
        name: "MirageMolasses",
        time_ms: 102_000,
        wheels: [{ swapTick: 0, vertices: createVertices([
            [0.42, 0.0], [0.32, 0.26], [0.26, 0.32], [0.0, 0.42],
            [-0.26, 0.32], [-0.32, 0.26], [-0.42, 0.0], [-0.32, -0.26],
            [-0.26, -0.32], [0.0, -0.42], [0.26, -0.32], [0.32, -0.26]
        ], 0.4) }]
    }
];

function main() {
    console.log(`Generating ${SEEDS.length} seed ghost blobs for track 3 (dunes-03)...`);
    console.log(`Track: Dune Drifter (48m, target 55s)`);
    console.log(`Zones: A(normal) → B(water) → C(rock+ramp) → D(ice+obstacles) → E(snow finish)`);
    console.log(`Physics version: ${PHYSICS_VERSION}`);
    console.log('');

    // Ensure directory exists
    mkdirSync(SEED_DIR, { recursive: true });

    const player_uuid = '00000000-0000-4000-8000-000000000001';

    let generated = 0;
    let failed = 0;

    SEEDS.forEach((seed, index) => {
        try {
            const blob = encodeGhostBlob({
                trackId: TRACK_ID,
                finishTimeMs: seed.time_ms,
                playerUuid: player_uuid,
                wheels: seed.wheels,
                rawStrokePoints: []
            });

            const filename = `seed-${String(index).padStart(3, '0')}.blob`;
            const filepath = join(SEED_DIR, filename);
            writeFileSync(filepath, Buffer.from(blob));

            generated++;
            console.log(`✓ ${filename}: ${seed.name} (${(seed.time_ms / 1000).toFixed(1)}s, ${seed.wheels.length} wheel${seed.wheels.length > 1 ? 's' : ''})`);
        } catch (error) {
            failed++;
            console.error(`✗ Failed to generate seed-${index}: ${error}`);
        }
    });

    console.log('');
    console.log(`Generation complete:`);
    console.log(`  Generated: ${generated}`);
    console.log(`  Failed: ${failed}`);

    if (failed > 0) {
        process.exit(1);
    }

    console.log('');
    console.log('✓ All seed ghosts generated successfully!');
    console.log('');
    console.log('Bucket distribution:');
    console.log('  - elite    (pr ≤ 0.01):  1 ghost');
    console.log('  - advanced (pr ≤ 0.05):  1 ghost');
    console.log('  - skilled  (pr ≤ 0.20):  5 ghosts');
    console.log('  - mid      (pr ≤ 0.50):  8 ghosts');
    console.log('  - novice   (pr >  0.50): 15 ghosts');
    console.log('');
    console.log('Next step: Run validation to verify all ghosts');
}

main();