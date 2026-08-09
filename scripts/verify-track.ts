#!/usr/bin/env tsx
/**
 * Track file verification script
 * Usage: npx tsx scripts/verify-track.ts <track-file>
 *
 * Verifies that a track JSON file:
 * - Exists and is readable
 * - Parses as valid JSON
 * - Matches the expected track schema
 * - Has no structural errors
 */

import fs from 'fs';
import path from 'path';

const trackFile = process.argv[2];

if (!trackFile) {
  console.error('Usage: npx tsx scripts/verify-track.ts <track-file>');
  process.exit(1);
}

const trackPath = path.resolve(process.cwd(), trackFile);

interface Track {
  id: string;
  numeric_id: number;
  name: string;
  version: number;
  world: {
    gravity: [number, number];
    pixelsPerMeter: number;
  };
  camera: {
    followAxis: string;
    deadzone: [number, number];
    maxZoomOut: number;
  };
  terrain: [number, number][];
  surfaces?: { x_range: [number, number]; type: string }[];
  obstacles?: { type: string; pos: [number, number]; size?: [number, number]; radius?: number; angle?: number }[];
  ramps?: { polyline?: [number, number][]; x_start?: number; x_end?: number; zone?: string }[];
  zones?: { id: string; x_start: number; x_end: number }[];
  start: { pos: [number, number]; facing: number };
  finish: { pos: [number, number]; width: number };
  hazards?: { type: string; x_start?: number; x_end?: number; x_range?: [number, number]; y?: number; depthMeters?: number }[];
  metadata: {
    targetTimeSeconds: number;
    tutorialGhosts: string[];
  };
}

function validateTrack(track: Track, filepath: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required top-level fields
  if (!track.id) errors.push('Missing required field: id');
  if (typeof track.numeric_id !== 'number') errors.push('Missing or invalid field: numeric_id');
  if (!track.name) errors.push('Missing required field: name');
  if (typeof track.version !== 'number') errors.push('Missing or invalid field: version');

  // World settings
  if (!track.world) errors.push('Missing required field: world');
  else {
    if (!Array.isArray(track.world.gravity) || track.world.gravity.length !== 2) {
      errors.push('Invalid world.gravity (must be [x, y])');
    }
    if (typeof track.world.pixelsPerMeter !== 'number') {
      errors.push('Invalid world.pixelsPerMeter');
    }
  }

  // Camera settings
  if (!track.camera) errors.push('Missing required field: camera');
  else {
    if (typeof track.camera.followAxis !== 'string') {
      errors.push('Invalid camera.followAxis');
    }
    if (!Array.isArray(track.camera.deadzone) || track.camera.deadzone.length !== 2) {
      errors.push('Invalid camera.deadzone (must be [x, y])');
    }
  }

  // Terrain
  if (!Array.isArray(track.terrain) || track.terrain.length < 2) {
    errors.push('Invalid terrain (must be array of at least 2 [x, y] points)');
  } else {
    // Check terrain is strictly increasing in X
    for (let i = 1; i < track.terrain.length; i++) {
      if (track.terrain[i][0] <= track.terrain[i-1][0]) {
        errors.push(`Terrain X coordinates must be strictly increasing (found ${track.terrain[i-1][0]} -> ${track.terrain[i][0]} at index ${i-1})`);
        break;
      }
    }
  }

  // Surfaces (optional but recommended)
  if (track.surfaces) {
    const validTypes = ['normal', 'ice', 'snow', 'water', 'mud', 'rock'];
    for (const surface of track.surfaces) {
      if (!Array.isArray(surface.x_range) || surface.x_range.length !== 2) {
        errors.push(`Invalid surface.x_range: ${JSON.stringify(surface)}`);
      }
      if (!validTypes.includes(surface.type)) {
        errors.push(`Invalid surface type: ${surface.type} (must be one of: ${validTypes.join(', ')})`);
      }
    }
  }

  // Zones (optional)
  if (track.zones) {
    for (const zone of track.zones) {
      if (!zone.id) errors.push(`Zone missing id: ${JSON.stringify(zone)}`);
      if (typeof zone.x_start !== 'number' || typeof zone.x_end !== 'number') {
        errors.push(`Invalid zone x_range: ${JSON.stringify(zone)}`);
      }
    }
  }

  // Start position
  if (!track.start) errors.push('Missing required field: start');
  else {
    if (!Array.isArray(track.start.pos) || track.start.pos.length !== 2) {
      errors.push('Invalid start.pos (must be [x, y])');
    }
    if (typeof track.start.facing !== 'number') {
      errors.push('Invalid start.facing');
    }
    // Check start is above terrain at start x
    const startX = track.start.pos[0];
    const terrainAtStart = track.terrain.find(t => t[0] === startX);
    if (terrainAtStart && track.start.pos[1] >= terrainAtStart[1]) {
      errors.push(`Start position Y (${track.start.pos[1]}) must be less than terrain Y at x=${startX} (${terrainAtStart[1]})`);
    }
  }

  // Finish position
  if (!track.finish) errors.push('Missing required field: finish');
  else {
    if (!Array.isArray(track.finish.pos) || track.finish.pos.length !== 2) {
      errors.push('Invalid finish.pos (must be [x, y])');
    }
    if (typeof track.finish.width !== 'number') {
      errors.push('Invalid finish.width');
    }
  }

  // Metadata
  if (!track.metadata) errors.push('Missing required field: metadata');
  else {
    if (typeof track.metadata.targetTimeSeconds !== 'number') {
      errors.push('Invalid metadata.targetTimeSeconds');
    }
    if (!Array.isArray(track.metadata.tutorialGhosts)) {
      errors.push('Invalid metadata.tutorialGhosts');
    }
  }

  return { valid: errors.length === 0, errors };
}

try {
  // Check file exists
  if (!fs.existsSync(trackPath)) {
    console.error(`❌ File not found: ${trackPath}`);
    process.exit(1);
  }

  // Read and parse
  const content = fs.readFileSync(trackPath, 'utf-8');
  let track: Track;
  try {
    track = JSON.parse(content);
  } catch (parseError) {
    console.error(`❌ JSON parse error in ${trackFile}:`);
    console.error(`   ${parseError instanceof SyntaxError ? parseError.message : String(parseError)}`);
    process.exit(1);
  }

  // Validate structure
  const { valid, errors } = validateTrack(track, trackFile);

  if (valid) {
    console.log(`✅ ${trackFile} loads successfully and passes validation`);
    console.log(`   Track ID: ${track.id}`);
    console.log(`   Numeric ID: ${track.numeric_id}`);
    console.log(`   Name: ${track.name}`);
    console.log(`   Version: ${track.version}`);
    console.log(`   Length: ${track.terrain[track.terrain.length - 1][0]}m`);
    console.log(`   Zones: ${track.zones?.length || 0}`);
    console.log(`   Surfaces: ${track.surfaces?.length || 0}`);
    console.log(`   Obstacles: ${track.obstacles?.length || 0}`);
    console.log(`   Hazards: ${track.hazards?.length || 0}`);
    process.exit(0);
  } else {
    console.error(`❌ ${trackFile} has validation errors:`);
    errors.forEach(err => console.error(`   - ${err}`));
    process.exit(1);
  }
} catch (error) {
  console.error(`❌ Error reading ${trackFile}:`);
  console.error(`   ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
