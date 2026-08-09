#!/usr/bin/env node

/**
 * Simple script to test loading and parsing canyon-02.json
 *
 * This script:
 * - Loads the canyon-02.json track file
 * - Attempts to parse the JSON
 * - Includes error handling for parse errors
 * - Outputs success/failure status
 *
 * Usage: node scripts/test-track-json-load.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRACK_FILE = path.join(__dirname, '../apps/web/public/tracks/canyon-02.json');

function testJsonLoad() {
  console.log('Testing JSON load and parse for canyon-02.json');
  console.log(`File path: ${TRACK_FILE}`);
  console.log('');

  try {
    // Check if file exists
    if (!fs.existsSync(TRACK_FILE)) {
      console.error('❌ FAILED: File does not exist');
      process.exit(1);
    }

    // Read file content
    console.log('📂 Reading file...');
    const fileContent = fs.readFileSync(TRACK_FILE, 'utf-8');

    // Check if file is empty
    if (!fileContent || fileContent.trim().length === 0) {
      console.error('❌ FAILED: File is empty');
      process.exit(1);
    }

    console.log(`✓ File read successfully (${fileContent.length} bytes)`);

    // Attempt to parse JSON
    console.log('🔄 Parsing JSON...');
    const parsedData = JSON.parse(fileContent);

    // Validate basic structure
    console.log('✓ JSON parsed successfully');

    // Check for required fields
    const requiredFields = ['id', 'numeric_id', 'name', 'version', 'world', 'camera', 'terrain', 'start', 'finish'];
    const missingFields = requiredFields.filter(field => !parsedData.hasOwnProperty(field));

    if (missingFields.length > 0) {
      console.error(`❌ FAILED: Missing required fields: ${missingFields.join(', ')}`);
      process.exit(1);
    }

    console.log(`✓ All required fields present`);
    console.log(`✓ Track ID: ${parsedData.id}`);
    console.log(`✓ Track name: ${parsedData.name}`);
    console.log(`✓ Terrain points: ${parsedData.terrain.length}`);
    console.log(`✓ Zones: ${parsedData.zones.length}`);
    console.log(`✓ Surfaces: ${parsedData.surfaces.length}`);
    console.log(`✓ Obstacles: ${parsedData.obstacles.length}`);

    console.log('');
    console.log('✅ SUCCESS: canyon-02.json loaded and validated successfully');
    process.exit(0);

  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error('❌ FAILED: JSON parse error');
      console.error(`   Error: ${error.message}`);
      console.error(`   Position: line ${error.message.match(/line (\d+)/)?.[1] || 'unknown'}`);
    } else {
      console.error('❌ FAILED: Unexpected error');
      console.error(`   Error: ${error.message}`);
    }

    process.exit(1);
  }
}

// Run the test
testJsonLoad();