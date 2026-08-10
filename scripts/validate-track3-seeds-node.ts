#!/usr/bin/env tsx
/**
 * Validate existing track 3 seed ghosts using the web app's blob parser
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { decodeGhostBlobWheels, decodeGhostBlobFinishTime } from '../apps/web/src/ghost-blob';

const TRACK_3_DIR = 'seeds/track_3';
const TRACK_ID = 3;

function main() {
    console.log('Validating track 3 (dunes-03) seed ghosts...');
    console.log('Track: Dune Drifter (48m, target 55s)');
    console.log('Zones: A(normal) → B(water) → C(rock+ramp) → D(ice+obstacles) → E(snow)');
    console.log();

    const seedDir = TRACK_3_DIR;
    let blobFiles: string[] = [];

    try {
        blobFiles = readdirSync(seedDir)
            .filter(file => file.endsWith('.blob'))
            .sort();
    } catch (error) {
        console.error(`Failed to read seed directory: ${error}`);
        process.exit(1);
    }

    console.log(`Found ${blobFiles.length} seed files`);
    console.log();

    let validCount = 0;
    let invalidCount = 0;
    const filesToDelete: string[] = [];

    for (const filename of blobFiles) {
        const filepath = join(seedDir, filename);

        try {
            const blobBuffer = readFileSync(filepath);
            const blobArrayBuffer = blobBuffer.buffer.slice(blobBuffer.byteOffset, blobBuffer.byteOffset + blobBuffer.byteLength);
            const view = new DataView(blobArrayBuffer);
            const bytes = new Uint8Array(blobArrayBuffer);

            // Parse header manually
            let offset = 0;

            // Check magic
            const magic = bytes.slice(0, 4);
            const expectedMagic = new Uint8Array([0x44, 0x52, 0x47, 0x48]); // "DRGH"
            if (magic[0] !== expectedMagic[0] || magic[1] !== expectedMagic[1] ||
                magic[2] !== expectedMagic[2] || magic[3] !== expectedMagic[3]) {
                throw new Error('Invalid magic number');
            }
            offset += 4;

            const version = view.getUint8(offset);
            offset += 1;

            const trackId = view.getUint16(offset, true);
            offset += 2;

            const flags = view.getUint8(offset);
            offset += 1;

            const finishTimeMs = view.getUint32(offset, true);
            offset += 4;

            // Parse wheels using the existing function
            const wheels = decodeGhostBlobWheels(blobArrayBuffer);

            // Validate basic structure
            const issues: string[] = [];

            if (trackId !== TRACK_ID) {
                issues.push(`track_id is ${trackId}, expected ${TRACK_ID}`);
            }

            if (finishTimeMs === 0) {
                issues.push('finish_time_ms is 0');
            }

            if (finishTimeMs > 180_000) {
                issues.push(`finish_time_ms ${finishTimeMs} exceeds 3 minutes`);
            }

            if (wheels.length === 0) {
                issues.push('wheel_count is 0');
            }

            if (wheels.length > 21) {
                issues.push(`wheel_count ${wheels.length} exceeds cap of 20`);
            }

            const totalVertices = wheels.reduce((sum, wheel) => sum + wheel.vertices.length, 0);
            if (totalVertices === 0) {
                issues.push('total vertices is 0');
            }

            // Validate wheel structure
            for (let i = 0; i < wheels.length; i++) {
                const wheel = wheels[i];
                if (wheel.vertices.length < 8) {
                    issues.push(`wheel ${i} has ${wheel.vertices.length} vertices (min 8)`);
                }
                if (wheel.vertices.length > 32) {
                    issues.push(`wheel ${i} has ${wheel.vertices.length} vertices (max 32)`);
                }
            }

            // Validate swap timing
            for (let i = 1; i < wheels.length; i++) {
                const prevTick = wheels[i - 1].swapTick;
                const currTick = wheels[i].swapTick;

                if (currTick <= prevTick) {
                    issues.push(`wheel ${i} swap_tick ${currTick} <= previous ${prevTick}`);
                }

                const tickGap = currTick - prevTick;
                const minGapTicks = 30; // 500ms cooldown @ 1/60s
                if (tickGap < minGapTicks) {
                    issues.push(`wheel ${i} swap gap ${tickGap} ticks < 500ms cooldown`);
                }
            }

            // Check time reasonableness for track 3
            const timeSec = finishTimeMs / 1000.0;
            if (timeSec < 20.0) {
                issues.push(`finish time ${timeSec.toFixed(1)}s is unrealistically fast for 48m track`);
            }
            if (timeSec > 120.0) {
                issues.push(`finish time ${timeSec.toFixed(1)}s exceeds 2-minute DNF timeout`);
            }

            if (issues.length === 0) {
                console.log(`✓ ${filename}: version=${version}, track_id=${trackId}, time_ms=${timeSec.toFixed(1)}s, wheels=${wheels.length}, vertices=${totalVertices}`);
                validCount++;
            } else {
                console.log(`✗ ${filename}: Invalid - ${issues.join('; ')}`);
                invalidCount++;
                filesToDelete.push(filepath);
            }
        } catch (error: any) {
            console.log(`✗ ${filename}: Parse error - ${error?.message || error}`);
            invalidCount++;
            filesToDelete.push(filepath);
        }
    }

    console.log();
    console.log('Validation complete:');
    console.log(`  Valid:   ${validCount}`);
    console.log(`  Invalid: ${invalidCount}`);

    // Note: We're not actually deleting files in this version
    if (invalidCount > 0) {
        console.log();
        console.log(`Found ${invalidCount} invalid seed files (would delete):`);
        filesToDelete.forEach(file => console.log(`  ${file}`));
        process.exit(1);
    }

    console.log();
    console.log('✓ All track 3 seed ghosts validated successfully!');
}

main();