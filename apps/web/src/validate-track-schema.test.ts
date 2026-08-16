/**
 * Tests for track JSON schema validation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { validateTrack, ValidationResult } from './validate-track-schema';
import fs from 'fs';
import path from 'path';

describe('validateTrack', () => {
  describe('canyon-02.json', () => {
    const canyonJsonPath = path.join(__dirname, '../public/tracks/canyon-02.json');
    let canyonJson: any;
    let result: ValidationResult;

    beforeAll(() => {
      const content = fs.readFileSync(canyonJsonPath, 'utf-8');
      canyonJson = JSON.parse(content);
      result = validateTrack(canyonJson, canyonJsonPath);
    });

    it('should pass validation', () => {
      expect(result.valid, 'Track validation should pass for valid canyon-02.json').toBe(true);
    });

    it('should have no errors', () => {
      expect(result.errors, 'Valid track should have no validation errors').toEqual([]);
    });

    it('should have required top-level fields', () => {
      expect(canyonJson, 'Track should have id field').toHaveProperty('id', 'canyon-02');
      expect(canyonJson, 'Track should have numeric_id field').toHaveProperty('numeric_id', 2);
      expect(canyonJson, 'Track should have name field').toHaveProperty('name', 'Canyon Run');
      expect(canyonJson, 'Track should have version field').toHaveProperty('version', 1);
    });

    it('should have world configuration', () => {
      expect(canyonJson.world, 'Track should have world configuration').toHaveProperty('gravity');
      expect(canyonJson.world.gravity, 'World gravity should be [0.0, 10.0]').toEqual([0.0, 10.0]);
      expect(canyonJson.world, 'World should have pixelsPerMeter').toHaveProperty('pixelsPerMeter', 30);
    });

    it('should have camera configuration', () => {
      expect(canyonJson.camera, 'Track should have camera configuration').toHaveProperty('followAxis', 'x');
      expect(canyonJson.camera, 'Camera should have deadzone').toHaveProperty('deadzone');
      expect(canyonJson.camera.deadzone, 'Camera deadzone should be [120, 80]').toEqual([120, 80]);
      expect(canyonJson.camera, 'Camera should have maxZoomOut').toHaveProperty('maxZoomOut', 1.0);
    });

    it('should have valid terrain points', () => {
      expect(Array.isArray(canyonJson.terrain), 'Terrain should be an array').toBe(true);
      expect(canyonJson.terrain.length, 'Terrain should have at least 2 points').toBeGreaterThan(1);

      // Check X coordinates are strictly increasing
      for (let i = 1; i < canyonJson.terrain.length; i++) {
        expect(
          canyonJson.terrain[i][0] > canyonJson.terrain[i - 1][0],
          `Terrain point ${i} X coordinate (${canyonJson.terrain[i][0]}) should be greater than previous (${canyonJson.terrain[i - 1][0]})`
        ).toBe(true);
      }
    });

    it('should have valid surfaces', () => {
      expect(Array.isArray(canyonJson.surfaces), 'Surfaces should be an array').toBe(true);
      expect(canyonJson.surfaces.length, 'Surfaces array should not be empty').toBeGreaterThan(0);

      const validTypes = ['normal', 'ice', 'snow', 'water', 'mud', 'rock'];

      for (const surface of canyonJson.surfaces) {
        expect(surface, 'Surface should have type property').toHaveProperty('type');
        expect(validTypes.includes(surface.type), `Surface type '${surface.type}' should be one of: ${validTypes.join(', ')}`).toBe(true);
        expect(Array.isArray(surface.x_range), 'Surface x_range should be an array').toBe(true);
        expect(surface.x_range, 'Surface x_range should have 2 elements').toHaveLength(2);
        expect(
          surface.x_range[0] < surface.x_range[1],
          `Surface x_range[0] (${surface.x_range[0]}) should be less than x_range[1] (${surface.x_range[1]})`
        ).toBe(true);
      }
    });

    it('should have valid obstacles', () => {
      expect(Array.isArray(canyonJson.obstacles), 'Obstacles should be an array').toBe(true);
      expect(canyonJson.obstacles.length, 'Obstacles array should not be empty').toBeGreaterThan(0);

      const validTypes = ['box', 'circle'];

      for (const obstacle of canyonJson.obstacles) {
        expect(obstacle, 'Obstacle should have type property').toHaveProperty('type');
        expect(validTypes.includes(obstacle.type), `Obstacle type '${obstacle.type}' should be one of: ${validTypes.join(', ')}`).toBe(true);
        expect(Array.isArray(obstacle.pos), 'Obstacle pos should be an array').toBe(true);
        expect(obstacle.pos, 'Obstacle pos should have 2 coordinates').toHaveLength(2);
      }
    });

    it('should have valid zones', () => {
      expect(Array.isArray(canyonJson.zones), 'Zones should be an array').toBe(true);
      expect(canyonJson.zones.length, 'Zones array should not be empty').toBeGreaterThan(0);

      for (const zone of canyonJson.zones) {
        expect(zone, 'Zone should have id property').toHaveProperty('id');
        expect(typeof zone.id === 'string', `Zone id should be a string, got ${typeof zone.id}`).toBe(true);
        expect(typeof zone.x_start === 'number', `Zone x_start should be a number, got ${typeof zone.x_start}`).toBe(true);
        expect(typeof zone.x_end === 'number', `Zone x_end should be a number, got ${typeof zone.x_end}`).toBe(true);
        expect(
          zone.x_start < zone.x_end,
          `Zone x_start (${zone.x_start}) should be less than x_end (${zone.x_end})`
        ).toBe(true);
      }
    });

    it('should have valid start position', () => {
      expect(canyonJson.start, 'Track should have start configuration').toHaveProperty('pos');
      expect(Array.isArray(canyonJson.start.pos), 'Start pos should be an array').toBe(true);
      expect(canyonJson.start.pos, 'Start pos should have 2 coordinates').toHaveLength(2);
      expect(canyonJson.start, 'Start should have facing property').toHaveProperty('facing', 1);
    });

    it('should have valid finish position', () => {
      expect(canyonJson.finish, 'Track should have finish configuration').toHaveProperty('pos');
      expect(Array.isArray(canyonJson.finish.pos), 'Finish pos should be an array').toBe(true);
      expect(canyonJson.finish.pos, 'Finish pos should have 2 coordinates').toHaveLength(2);
      expect(canyonJson.finish, 'Finish should have width property').toHaveProperty('width');
      expect(canyonJson.finish.width > 0, `Finish width (${canyonJson.finish.width}) should be greater than 0`).toBe(true);
    });

    it('should have valid hazards', () => {
      expect(Array.isArray(canyonJson.hazards), 'Hazards should be an array').toBe(true);
      expect(canyonJson.hazards.length, 'Hazards array should not be empty').toBeGreaterThan(0);

      const validTypes = ['pit'];

      for (const hazard of canyonJson.hazards) {
        expect(hazard, 'Hazard should have type property').toHaveProperty('type');
        expect(validTypes.includes(hazard.type), `Hazard type '${hazard.type}' should be one of: ${validTypes.join(', ')}`).toBe(true);
        expect(typeof hazard.x_start === 'number', `Hazard x_start should be a number, got ${typeof hazard.x_start}`).toBe(true);
        expect(typeof hazard.x_end === 'number', `Hazard x_end should be a number, got ${typeof hazard.x_end}`).toBe(true);
        expect(
          hazard.x_start < hazard.x_end,
          `Hazard x_start (${hazard.x_start}) should be less than x_end (${hazard.x_end})`
        ).toBe(true);
      }
    });
  });

  describe('dunes-03.json', () => {
    const dunesJsonPath = path.join(__dirname, '../public/tracks/dunes-03.json');
    let dunesJson: any;
    let result: ValidationResult;

    beforeAll(() => {
      const content = fs.readFileSync(dunesJsonPath, 'utf-8');
      dunesJson = JSON.parse(content);
      result = validateTrack(dunesJson, dunesJsonPath);
    });

    it('should pass validation', () => {
      expect(result.valid, 'Track validation should pass for valid dunes-03.json').toBe(true);
    });

    it('should have no errors', () => {
      expect(result.errors, 'Valid track should have no validation errors').toEqual([]);
    });

    it('should have correct track identity', () => {
      expect(dunesJson, 'Track should have id field').toHaveProperty('id', 'dunes-03');
      expect(dunesJson, 'Track should have numeric_id field').toHaveProperty('numeric_id', 3);
      expect(dunesJson, 'Track should have name field').toHaveProperty('name', 'Dune Drifter');
    });

    it('should be longer than canyon-02', () => {
      // dunes-03 is the longest track at 48m
      const lastTerrainPoint = dunesJson.terrain[dunesJson.terrain.length - 1][0];
      expect(lastTerrainPoint, `Final terrain point X should be 48 for dunes-03, got ${lastTerrainPoint}`).toBe(48);
    });

    it('should have snow surface on final zone', () => {
      const snowSurface = dunesJson.surfaces?.find((s: any) => s.type === 'snow');
      expect(snowSurface, 'Dunes track should have snow surface').toBeDefined();
      expect(snowSurface.x_range[0], `Snow surface should start at x=38, got ${snowSurface.x_range[0]}`).toBe(38);
      expect(snowSurface.x_range[1], `Snow surface should end at x=48, got ${snowSurface.x_range[1]}`).toBe(48);
    });
  });

  describe('validation error cases', () => {
    it('should reject track missing required fields', () => {
      const invalidTrack = {
        id: 'test-01'
        // missing numeric_id, name, version, world, camera, terrain, start, finish
      };

      const result = validateTrack(invalidTrack, 'test-track.json');
      expect(result.valid, 'Track missing required fields should be invalid').toBe(false);
      expect(result.errors.length, 'Invalid track should have validation errors').toBeGreaterThan(0);
      expect(
        result.errors.some(e => e.includes('Missing required field')),
        'Should report missing required fields error'
      ).toBe(true);
    });

    it('should reject track with invalid numeric_id', () => {
      const invalidTrack = {
        id: 'test-01',
        numeric_id: -1, // negative
        name: 'Test Track',
        version: 1,
        world: { gravity: [0, 10], pixelsPerMeter: 30 },
        camera: { followAxis: 'x', deadzone: [120, 80], maxZoomOut: 1.0 },
        terrain: [[0, 0], [10, 0]],
        start: { pos: [1, 0], facing: 1 },
        finish: { pos: [10, 0], width: 0.2 }
      };

      const result = validateTrack(invalidTrack, 'test-track.json');
      expect(result.valid, 'Track with negative numeric_id should be invalid').toBe(false);
      expect(
        result.errors.some(e => e.includes('numeric_id')),
        'Should report numeric_id validation error'
      ).toBe(true);
    });

    it('should reject track with non-increasing terrain X coordinates', () => {
      const invalidTrack = {
        id: 'test-01',
        numeric_id: 1,
        name: 'Test Track',
        version: 1,
        world: { gravity: [0, 10], pixelsPerMeter: 30 },
        camera: { followAxis: 'x', deadzone: [120, 80], maxZoomOut: 1.0 },
        terrain: [[0, 0], [10, 0], [5, 0]], // X goes from 10 back to 5
        start: { pos: [1, 0], facing: 1 },
        finish: { pos: [10, 0], width: 0.2 }
      };

      const result = validateTrack(invalidTrack, 'test-track.json');
      expect(result.valid, 'Track with non-increasing terrain X coordinates should be invalid').toBe(false);
      expect(
        result.errors.some(e => e.includes('strictly increasing')),
        'Should report terrain X coordinate validation error'
      ).toBe(true);
    });

    it('should reject track with invalid surface type', () => {
      const invalidTrack = {
        id: 'test-01',
        numeric_id: 1,
        name: 'Test Track',
        version: 1,
        world: { gravity: [0, 10], pixelsPerMeter: 30 },
        camera: { followAxis: 'x', deadzone: [120, 80], maxZoomOut: 1.0 },
        terrain: [[0, 0], [10, 0]],
        surfaces: [{ x_range: [0, 10], type: 'invalid_type' }],
        start: { pos: [1, 0], facing: 1 },
        finish: { pos: [10, 0], width: 0.2 }
      };

      const result = validateTrack(invalidTrack, 'test-track.json');
      expect(result.valid, 'Track with invalid surface type should be invalid').toBe(false);
      expect(
        result.errors.some(e => e.includes('invalid type')),
        'Should report invalid surface type error'
      ).toBe(true);
    });

    it('should reject zone where x_start >= x_end', () => {
      const invalidTrack = {
        id: 'test-01',
        numeric_id: 1,
        name: 'Test Track',
        version: 1,
        world: { gravity: [0, 10], pixelsPerMeter: 30 },
        camera: { followAxis: 'x', deadzone: [120, 80], maxZoomOut: 1.0 },
        terrain: [[0, 0], [10, 0]],
        zones: [{ id: 'A', x_start: 5, x_end: 3 }], // x_start > x_end
        start: { pos: [1, 0], facing: 1 },
        finish: { pos: [10, 0], width: 0.2 }
      };

      const result = validateTrack(invalidTrack, 'test-track.json');
      expect(result.valid, 'Track with zone where x_start >= x_end should be invalid').toBe(false);
      expect(
        result.errors.some(e => e.includes('x_start') && e.includes('x_end')),
        'Should report zone coordinate validation error'
      ).toBe(true);
    });
  });
});