#!/usr/bin/env node
/**
 * Standalone test script to verify canyon-02.json loads without errors
 *
 * This script validates that:
 * - The file exists and is readable
 * - The JSON parses correctly
 * - All required fields are present
 * - The data structure is valid
 *
 * Usage: node scripts/test-canyon-02-loading.js
 */

const fs = require('fs');
const path = require('path');

const TRACK_PATH = path.join(__dirname, '../apps/web/public/tracks/canyon-02.json');

console.log('Testing canyon-02.json loading...\n');

// Test 1: File exists and is readable
try {
  fs.accessSync(TRACK_PATH, fs.constants.R_OK);
  console.log('✓ File exists and is readable');
} catch (e) {
  console.error('✗ File access error:', e.message);
  process.exit(1);
}

// Test 2: JSON parsing
let trackData;
try {
  const rawContent = fs.readFileSync(TRACK_PATH, 'utf-8');
  trackData = JSON.parse(rawContent);
  console.log('✓ JSON parses without errors');
} catch (e) {
  console.error('✗ JSON parse error:', e.message);
  process.exit(1);
}

// Test 3: Required fields exist
const requiredFields = [
  'id', 'numeric_id', 'name', 'version',
  'world', 'camera', 'terrain', 'start', 'finish', 'metadata'
];

const missingFields = requiredFields.filter(field => !(field in trackData));
if (missingFields.length > 0) {
  console.error('✗ Missing required fields:', missingFields.join(', '));
  process.exit(1);
}
console.log('✓ All required fields present');

// Test 4: Data types and basic validation
const validations = [
  () => typeof trackData.id === 'string' && trackData.id === 'canyon-02',
  () => typeof trackData.numeric_id === 'number' && trackData.numeric_id === 2,
  () => typeof trackData.name === 'string',
  () => typeof trackData.version === 'number',
  () => Array.isArray(trackData.terrain) && trackData.terrain.length > 0,
  () => Array.isArray(trackData.zones) && trackData.zones.length > 0,
  () => Array.isArray(trackData.surfaces),
  () => typeof trackData.world.gravity === 'object',
  () => typeof trackData.world.pixelsPerMeter === 'number',
  () => typeof trackData.start.pos === 'object',
  () => typeof trackData.finish.pos === 'object'
];

const failedValidations = validations.map((v, i) => ({ test: i, pass: v() })).filter(r => !r.pass);

if (failedValidations.length > 0) {
  console.error('✗ Data validation failed for', failedValidations.length, 'checks');
  process.exit(1);
}
console.log('✓ All data types and values are valid');

// Test 5: Terrain structure
const terrainValid = trackData.terrain.every(point =>
  Array.isArray(point) &&
  point.length === 2 &&
  typeof point[0] === 'number' &&
  typeof point[1] === 'number'
);

if (!terrainValid) {
  console.error('✗ Terrain data structure invalid');
  process.exit(1);
}
console.log('✓ Terrain structure is valid');

// Test 6: Terrain X-coordinates are strictly increasing
for (let i = 1; i < trackData.terrain.length; i++) {
  if (trackData.terrain[i][0] <= trackData.terrain[i - 1][0]) {
    console.error('✗ Terrain X-coordinates not strictly increasing at index', i);
    process.exit(1);
  }
}
console.log('✓ Terrain X-coordinates are strictly increasing');

// Summary
console.log('\n=== Summary ===');
console.log('Track:', trackData.name);
console.log('ID:', trackData.id);
console.log('Numeric ID:', trackData.numeric_id);
console.log('Version:', trackData.version);
console.log('Terrain points:', trackData.terrain.length);
console.log('Zones:', trackData.zones.length);
console.log('Surfaces:', trackData.surfaces.length);
console.log('Obstacles:', trackData.obstacles.length);
console.log('Hazards:', trackData.hazards.length);
console.log('Target time:', trackData.metadata.targetTimeSeconds, 'seconds');
console.log('\n✓ All tests passed! canyon-02.json loads without errors.');
