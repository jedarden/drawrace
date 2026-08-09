#!/usr/bin/env tsx
/**
 * Track JSON Schema Validation Tool
 *
 * Validates track JSON files against the documented schema format from docs/plan/plan.md
 * §Gameplay & Physics 5 - Track Design Format
 */

import fs from 'fs';
import path from 'path';

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface TrackSurface {
  x_range: [number, number];
  type: string;
}

interface TrackObstacle {
  type: string;
  pos: [number, number];
  size: [number, number];
  radius?: number;
  angle?: number;
  friction?: number;
}

interface TrackZone {
  id: string;
  x_start: number;
  x_end: number;
  name?: string;
}

interface TrackStart {
  pos: [number, number];
  facing: number;
}

interface TrackFinish {
  pos: [number, number];
  width: number;
}

interface TrackHazard {
  type: string;
  x_start: number;
  x_end: number;
  y?: number;
  depthMeters?: number;
}

interface TrackRamp {
  zone: string;
  x_start: number;
  x_end: number;
  friction?: number;
}

interface TrackMetadata {
  targetTimeSeconds: number;
  tutorialGhosts: string[];
}

interface TrackJson {
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
  surfaces?: TrackSurface[];
  obstacles?: TrackObstacle[];
  ramps?: TrackRamp[];
  zones?: TrackZone[];
  start: TrackStart;
  finish: TrackFinish;
  hazards?: TrackHazard[];
  metadata?: TrackMetadata;
}

// Valid surface types from the spec
const VALID_SURFACE_TYPES = ['normal', 'ice', 'snow', 'water', 'mud', 'rock'];

// Valid obstacle types from the spec
const VALID_OBSTACLE_TYPES = ['box', 'circle'];

// Valid hazard types from the spec
const VALID_HAZARD_TYPES = ['pit'];

// Valid camera follow axis values
const VALID_FOLLOW_AXIS = ['x', 'y', 'xy'];

function validateTrack(json: unknown, filePath: string): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: []
  };

  // Type guard to ensure we have an object
  if (typeof json !== 'object' || json === null) {
    result.valid = false;
    result.errors.push(`Track file must be a JSON object, got ${typeof json}`);
    return result;
  }

  const track = json as Record<string, unknown>;

  // Validate required top-level fields
  const requiredFields = [
    'id',
    'numeric_id',
    'name',
    'version',
    'world',
    'camera',
    'terrain',
    'start',
    'finish'
  ];

  for (const field of requiredFields) {
    if (!(field in track)) {
      result.valid = false;
      result.errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate id (string)
  if (track.id !== undefined) {
    if (typeof track.id !== 'string') {
      result.valid = false;
      result.errors.push(`Field 'id' must be a string, got ${typeof track.id}`);
    }
  }

  // Validate numeric_id (number, uint16 range)
  if (track.numeric_id !== undefined) {
    if (typeof track.numeric_id !== 'number') {
      result.valid = false;
      result.errors.push(`Field 'numeric_id' must be a number, got ${typeof track.numeric_id}`);
    } else if (track.numeric_id < 0 || track.numeric_id > 65535 || !Number.isInteger(track.numeric_id)) {
      result.valid = false;
      result.errors.push(`Field 'numeric_id' must be a uint16 (0-65535), got ${track.numeric_id}`);
    }
  }

  // Validate name (string)
  if (track.name !== undefined && typeof track.name !== 'string') {
    result.valid = false;
    result.errors.push(`Field 'name' must be a string, got ${typeof track.name}`);
  }

  // Validate version (positive number)
  if (track.version !== undefined) {
    if (typeof track.version !== 'number') {
      result.valid = false;
      result.errors.push(`Field 'version' must be a number, got ${typeof track.version}`);
    } else if (track.version < 1 || !Number.isInteger(track.version)) {
      result.valid = false;
      result.errors.push(`Field 'version' must be a positive integer, got ${track.version}`);
    }
  }

  // Validate world object
  if (track.world !== undefined) {
    if (typeof track.world !== 'object' || track.world === null) {
      result.valid = false;
      result.errors.push(`Field 'world' must be an object`);
    } else {
      const world = track.world as Record<string, unknown>;

      // Check gravity
      if (!world.gravity || typeof world.gravity !== 'object') {
        result.errors.push(`Field 'world.gravity' must be an array [x, y]`);
      } else {
        const gravity = world.gravity as unknown[];
        if (!Array.isArray(gravity) || gravity.length !== 2 ||
            typeof gravity[0] !== 'number' || typeof gravity[1] !== 'number') {
          result.valid = false;
          result.errors.push(`Field 'world.gravity' must be a 2-element number array [x, y]`);
        }
      }

      // Check pixelsPerMeter
      if (typeof world.pixelsPerMeter !== 'number') {
        result.valid = false;
        result.errors.push(`Field 'world.pixelsPerMeter' must be a number`);
      } else if (world.pixelsPerMeter <= 0) {
        result.valid = false;
        result.errors.push(`Field 'world.pixelsPerMeter' must be positive, got ${world.pixelsPerMeter}`);
      }
    }
  }

  // Validate camera object
  if (track.camera !== undefined) {
    if (typeof track.camera !== 'object' || track.camera === null) {
      result.valid = false;
      result.errors.push(`Field 'camera' must be an object`);
    } else {
      const camera = track.camera as Record<string, unknown>;

      // Check followAxis
      if (typeof camera.followAxis !== 'string') {
        result.errors.push(`Field 'camera.followAxis' must be a string`);
      } else if (!VALID_FOLLOW_AXIS.includes(camera.followAxis)) {
        result.valid = false;
        result.errors.push(`Field 'camera.followAxis' must be one of ${VALID_FOLLOW_AXIS.join(', ')}, got ${camera.followAxis}`);
      }

      // Check deadzone
      if (!camera.deadzone || typeof camera.deadzone !== 'object') {
        result.errors.push(`Field 'camera.deadzone' must be an array [width, height]`);
      } else {
        const deadzone = camera.deadzone as unknown[];
        if (!Array.isArray(deadzone) || deadzone.length !== 2 ||
            typeof deadzone[0] !== 'number' || typeof deadzone[1] !== 'number') {
          result.valid = false;
          result.errors.push(`Field 'camera.deadzone' must be a 2-element number array [width, height]`);
        }
      }

      // Check maxZoomOut
      if (typeof camera.maxZoomOut !== 'number') {
        result.valid = false;
        result.errors.push(`Field 'camera.maxZoomOut' must be a number`);
      } else if (camera.maxZoomOut <= 0 || camera.maxZoomOut > 10) {
        result.warnings.push(`Field 'camera.maxZoomOut' seems unusual: ${camera.maxZoomOut}`);
      }
    }
  }

  // Validate terrain (non-empty array of [x, y] points)
  if (track.terrain !== undefined) {
    if (!Array.isArray(track.terrain)) {
      result.valid = false;
      result.errors.push(`Field 'terrain' must be an array of [x, y] points`);
    } else if (track.terrain.length < 2) {
      result.valid = false;
      result.errors.push(`Field 'terrain' must have at least 2 points, got ${track.terrain.length}`);
    } else {
      // Check each terrain point
      for (let i = 0; i < track.terrain.length; i++) {
        const point = track.terrain[i];
        if (!Array.isArray(point) || point.length !== 2 ||
            typeof point[0] !== 'number' || typeof point[1] !== 'number') {
          result.valid = false;
          result.errors.push(`Terrain point ${i} must be a [x, y] number pair`);
        }
      }

      // Check X coordinates are strictly increasing
      for (let i = 1; i < track.terrain.length; i++) {
        const prevX = track.terrain[i - 1][0];
        const currX = track.terrain[i][0];
        if (currX <= prevX) {
          result.valid = false;
          result.errors.push(`Terrain X coordinates must be strictly increasing; at point ${i}: ${currX} <= ${prevX}`);
        }
      }
    }
  }

  // Validate surfaces (optional array)
  if (track.surfaces !== undefined) {
    if (!Array.isArray(track.surfaces)) {
      result.valid = false;
      result.errors.push(`Field 'surfaces' must be an array`);
    } else {
      for (let i = 0; i < track.surfaces.length; i++) {
        const surface = track.surfaces[i];
        if (typeof surface !== 'object' || surface === null) {
          result.valid = false;
          result.errors.push(`Surface ${i} must be an object`);
          continue;
        }

        const surf = surface as Record<string, unknown>;

        // Check x_range
        if (!surf.x_range || typeof surf.x_range !== 'object') {
          result.errors.push(`Surface ${i} must have 'x_range' field as [start, end]`);
        } else {
          const xRange = surf.x_range as unknown[];
          if (!Array.isArray(xRange) || xRange.length !== 2 ||
              typeof xRange[0] !== 'number' || typeof xRange[1] !== 'number') {
            result.valid = false;
            result.errors.push(`Surface ${i} 'x_range' must be a 2-element number array [start, end]`);
          } else if (xRange[0] >= xRange[1]) {
            result.valid = false;
            result.errors.push(`Surface ${i} 'x_range' start must be less than end: [${xRange[0]}, ${xRange[1]}]`);
          }
        }

        // Check type
        if (typeof surf.type !== 'string') {
          result.valid = false;
          result.errors.push(`Surface ${i} must have 'type' field as string`);
        } else if (!VALID_SURFACE_TYPES.includes(surf.type)) {
          result.valid = false;
          result.errors.push(`Surface ${i} has invalid type '${surf.type}', must be one of: ${VALID_SURFACE_TYPES.join(', ')}`);
        }
      }
    }
  }

  // Validate obstacles (optional array)
  if (track.obstacles !== undefined) {
    if (!Array.isArray(track.obstacles)) {
      result.valid = false;
      result.errors.push(`Field 'obstacles' must be an array`);
    } else {
      for (let i = 0; i < track.obstacles.length; i++) {
        const obstacle = track.obstacles[i];
        if (typeof obstacle !== 'object' || obstacle === null) {
          result.valid = false;
          result.errors.push(`Obstacle ${i} must be an object`);
          continue;
        }

        const obs = obstacle as Record<string, unknown>;

        // Check type
        if (typeof obs.type !== 'string') {
          result.valid = false;
          result.errors.push(`Obstacle ${i} must have 'type' field as string`);
        } else if (!VALID_OBSTACLE_TYPES.includes(obs.type)) {
          result.valid = false;
          result.errors.push(`Obstacle ${i} has invalid type '${obs.type}', must be one of: ${VALID_OBSTACLE_TYPES.join(', ')}`);
        }

        // Check pos
        if (!obs.pos || typeof obs.pos !== 'object') {
          result.valid = false;
          result.errors.push(`Obstacle ${i} must have 'pos' field as [x, y]`);
        } else {
          const pos = obs.pos as unknown[];
          if (!Array.isArray(pos) || pos.length !== 2 ||
              typeof pos[0] !== 'number' || typeof pos[1] !== 'number') {
            result.valid = false;
            result.errors.push(`Obstacle ${i} 'pos' must be a 2-element number array [x, y]`);
          }
        }

        // Check size for box type
        if (obs.type === 'box') {
          if (!obs.size || typeof obs.size !== 'object') {
            result.valid = false;
            result.errors.push(`Box obstacle ${i} must have 'size' field as [width, height]`);
          } else {
            const size = obs.size as unknown[];
            if (!Array.isArray(size) || size.length !== 2 ||
                typeof size[0] !== 'number' || typeof size[1] !== 'number') {
              result.valid = false;
              result.errors.push(`Box obstacle ${i} 'size' must be a 2-element number array [width, height]`);
            }
          }
        }

        // Check radius for circle type
        if (obs.type === 'circle') {
          if (typeof obs.radius !== 'number') {
            result.warnings.push(`Circle obstacle ${i} should have 'radius' field as number`);
          }
        }
      }
    }
  }

  // Validate zones (optional array)
  if (track.zones !== undefined) {
    if (!Array.isArray(track.zones)) {
      result.valid = false;
      result.errors.push(`Field 'zones' must be an array`);
    } else {
      for (let i = 0; i < track.zones.length; i++) {
        const zone = track.zones[i];
        if (typeof zone !== 'object' || zone === null) {
          result.valid = false;
          result.errors.push(`Zone ${i} must be an object`);
          continue;
        }

        const z = zone as Record<string, unknown>;

        // Check id
        if (typeof z.id !== 'string') {
          result.valid = false;
          result.errors.push(`Zone ${i} must have 'id' field as string`);
        }

        // Check x_start and x_end
        if (typeof z.x_start !== 'number') {
          result.valid = false;
          result.errors.push(`Zone ${i} must have 'x_start' field as number`);
        }
        if (typeof z.x_end !== 'number') {
          result.valid = false;
          result.errors.push(`Zone ${i} must have 'x_end' field as number`);
        }
        if (typeof z.x_start === 'number' && typeof z.x_end === 'number' && z.x_start >= z.x_end) {
          result.valid = false;
          result.errors.push(`Zone ${i} 'x_start' must be less than 'x_end': ${z.x_start} >= ${z.x_end}`);
        }
      }
    }
  }

  // Validate start object
  if (track.start !== undefined) {
    if (typeof track.start !== 'object' || track.start === null) {
      result.valid = false;
      result.errors.push(`Field 'start' must be an object`);
    } else {
      const start = track.start as Record<string, unknown>;

      // Check pos
      if (!start.pos || typeof start.pos !== 'object') {
        result.valid = false;
        result.errors.push(`Field 'start.pos' must be an array [x, y]`);
      } else {
        const pos = start.pos as unknown[];
        if (!Array.isArray(pos) || pos.length !== 2 ||
            typeof pos[0] !== 'number' || typeof pos[1] !== 'number') {
          result.valid = false;
          result.errors.push(`Field 'start.pos' must be a 2-element number array [x, y]`);
        }
      }

      // Check facing
      if (typeof start.facing !== 'number') {
        result.valid = false;
        result.errors.push(`Field 'start.facing' must be a number`);
      } else if (start.facing !== 1 && start.facing !== -1) {
        result.warnings.push(`Field 'start.facing' is usually 1 or -1, got ${start.facing}`);
      }
    }
  }

  // Validate finish object
  if (track.finish !== undefined) {
    if (typeof track.finish !== 'object' || track.finish === null) {
      result.valid = false;
      result.errors.push(`Field 'finish' must be an object`);
    } else {
      const finish = track.finish as Record<string, unknown>;

      // Check pos
      if (!finish.pos || typeof finish.pos !== 'object') {
        result.valid = false;
        result.errors.push(`Field 'finish.pos' must be an array [x, y]`);
      } else {
        const pos = finish.pos as unknown[];
        if (!Array.isArray(pos) || pos.length !== 2 ||
            typeof pos[0] !== 'number' || typeof pos[1] !== 'number') {
          result.valid = false;
          result.errors.push(`Field 'finish.pos' must be a 2-element number array [x, y]`);
        }
      }

      // Check width
      if (typeof finish.width !== 'number') {
        result.valid = false;
        result.errors.push(`Field 'finish.width' must be a number`);
      } else if (finish.width <= 0) {
        result.valid = false;
        result.errors.push(`Field 'finish.width' must be positive, got ${finish.width}`);
      }
    }
  }

  // Validate ramps (optional array)
  if (track.ramps !== undefined) {
    if (!Array.isArray(track.ramps)) {
      result.valid = false;
      result.errors.push(`Field 'ramps' must be an array`);
    } else {
      for (let i = 0; i < track.ramps.length; i++) {
        const ramp = track.ramps[i];
        if (typeof ramp !== 'object' || ramp === null) {
          result.valid = false;
          result.errors.push(`Ramp ${i} must be an object`);
          continue;
        }

        const r = ramp as Record<string, unknown>;

        // Check zone (string reference to zones array)
        if (typeof r.zone !== 'string') {
          result.valid = false;
          result.errors.push(`Ramp ${i} must have 'zone' field as string`);
        }

        // Check x_start and x_end
        if (typeof r.x_start !== 'number') {
          result.valid = false;
          result.errors.push(`Ramp ${i} must have 'x_start' field as number`);
        }
        if (typeof r.x_end !== 'number') {
          result.valid = false;
          result.errors.push(`Ramp ${i} must have 'x_end' field as number`);
        }
        if (typeof r.x_start === 'number' && typeof r.x_end === 'number' && r.x_start >= r.x_end) {
          result.valid = false;
          result.errors.push(`Ramp ${i} 'x_start' must be less than 'x_end': ${r.x_start} >= ${r.x_end}`);
        }

        // Check optional friction
        if (r.friction !== undefined && typeof r.friction !== 'number') {
          result.valid = false;
          result.errors.push(`Ramp ${i} 'friction' must be a number if provided`);
        }
      }
    }
  }

  // Validate hazards (optional array)
  if (track.hazards !== undefined) {
    if (!Array.isArray(track.hazards)) {
      result.valid = false;
      result.errors.push(`Field 'hazards' must be an array`);
    } else {
      for (let i = 0; i < track.hazards.length; i++) {
        const hazard = track.hazards[i];
        if (typeof hazard !== 'object' || hazard === null) {
          result.valid = false;
          result.errors.push(`Hazard ${i} must be an object`);
          continue;
        }

        const haz = hazard as Record<string, unknown>;

        // Check type
        if (typeof haz.type !== 'string') {
          result.valid = false;
          result.errors.push(`Hazard ${i} must have 'type' field as string`);
        } else if (!VALID_HAZARD_TYPES.includes(haz.type)) {
          result.valid = false;
          result.errors.push(`Hazard ${i} has invalid type '${haz.type}', must be one of: ${VALID_HAZARD_TYPES.join(', ')}`);
        }

        // Check x_start and x_end
        if (typeof haz.x_start !== 'number') {
          result.valid = false;
          result.errors.push(`Hazard ${i} must have 'x_start' field as number`);
        }
        if (typeof haz.x_end !== 'number') {
          result.valid = false;
          result.errors.push(`Hazard ${i} must have 'x_end' field as number`);
        }
        if (typeof haz.x_start === 'number' && typeof haz.x_end === 'number' && haz.x_start >= haz.x_end) {
          result.valid = false;
          result.errors.push(`Hazard ${i} 'x_start' must be less than 'x_end': ${haz.x_start} >= ${haz.x_end}`);
        }
      }
    }
  }

  // Validate metadata (optional)
  if (track.metadata !== undefined) {
    if (typeof track.metadata !== 'object' || track.metadata === null) {
      result.valid = false;
      result.errors.push(`Field 'metadata' must be an object`);
    } else {
      const metadata = track.metadata as Record<string, unknown>;

      // Check targetTimeSeconds
      if (metadata.targetTimeSeconds !== undefined) {
        if (typeof metadata.targetTimeSeconds !== 'number') {
          result.valid = false;
          result.errors.push(`Field 'metadata.targetTimeSeconds' must be a number`);
        } else if (metadata.targetTimeSeconds <= 0) {
          result.valid = false;
          result.errors.push(`Field 'metadata.targetTimeSeconds' must be positive, got ${metadata.targetTimeSeconds}`);
        }
      }

      // Check tutorialGhosts
      if (metadata.tutorialGhosts !== undefined) {
        if (!Array.isArray(metadata.tutorialGhosts)) {
          result.valid = false;
          result.errors.push(`Field 'metadata.tutorialGhosts' must be an array`);
        } else {
          for (let i = 0; i < metadata.tutorialGhosts.length; i++) {
            const ghost = metadata.tutorialGhosts[i];
            if (typeof ghost !== 'string') {
              result.valid = false;
              result.errors.push(`Field 'metadata.tutorialGhosts[${i}]' must be a string`);
            }
          }
        }
      }
    }
  }

  return result;
}

function main() {
  const files = process.argv.slice(2);

  if (files.length === 0) {
    console.error('Usage: validate-track-schema.ts <track.json> [...]');
    process.exit(1);
  }

  let allValid = true;

  for (const file of files) {
    console.log(`\n🔍 Validating: ${file}`);
    console.log('='.repeat(50));

    try {
      const content = fs.readFileSync(file, 'utf-8');
      const json = JSON.parse(content);
      const result = validateTrack(json, file);

      if (result.valid) {
        console.log(`✅ PASSED: ${file}`);
      } else {
        console.log(`❌ FAILED: ${file}`);
        allValid = false;
      }

      if (result.errors.length > 0) {
        console.log('\n🚫 Errors:');
        for (const error of result.errors) {
          console.log(`  - ${error}`);
        }
      }

      if (result.warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        for (const warning of result.warnings) {
          console.log(`  - ${warning}`);
        }
      }

      if (result.valid && result.warnings.length === 0) {
        console.log('✨ Schema validation passed with no issues!');
      }

    } catch (error) {
      console.error(`❌ Failed to read or parse ${file}:`, error);
      allValid = false;
    }
  }

  console.log('\n' + '='.repeat(50));
  if (allValid) {
    console.log('✅ All tracks are valid!');
    process.exit(0);
  } else {
    console.log('❌ Some tracks have validation errors!');
    process.exit(1);
  }
}

// Check if this file is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { validateTrack, ValidationResult };