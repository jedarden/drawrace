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
      expect(result.valid).toBe(true);
    });

    it('should have no errors', () => {
      expect(result.errors).toEqual([]);
    });

    it('should have required top-level fields', () => {
      expect(canyonJson).toHaveProperty('id', 'canyon-02');
      expect(canyonJson).toHaveProperty('numeric_id', 2);
      expect(canyonJson).toHaveProperty('name', 'Canyon Run');
      expect(canyonJson).toHaveProperty('version', 1);
    });

    it('should have world configuration', () => {
      expect(canyonJson.world).toHaveProperty('gravity');
      expect(canyonJson.world.gravity).toEqual([0.0, 10.0]);
      expect(canyonJson.world).toHaveProperty('pixelsPerMeter', 30);
    });

    it('should have camera configuration', () => {
      expect(canyonJson.camera).toHaveProperty('followAxis', 'x');
      expect(canyonJson.camera).toHaveProperty('deadzone');
      expect(canyonJson.camera.deadzone).toEqual([120, 80]);
      expect(canyonJson.camera).toHaveProperty('maxZoomOut', 1.0);
    });

    it('should have valid terrain points', () => {
      expect(Array.isArray(canyonJson.terrain)).toBe(true);
      expect(canyonJson.terrain.length).toBeGreaterThan(1);

      // Check X coordinates are strictly increasing
      for (let i = 1; i < canyonJson.terrain.length; i++) {
        expect(canyonJson.terrain[i][0]).toBeGreaterThan(canyonJson.terrain[i - 1][0]);
      }
    });

    it('should have valid surfaces', () => {
      expect(Array.isArray(canyonJson.surfaces)).toBe(true);
      const validTypes = ['normal', 'ice', 'snow', 'water', 'mud', 'rock'];

      for (const surface of canyonJson.surfaces) {
        expect(surface).toHaveProperty('type');
        expect(validTypes).toContain(surface.type);
        expect(Array.isArray(surface.x_range)).toBe(true);
        expect(surface.x_range).toHaveLength(2);
        expect(surface.x_range[0]).toBeLessThan(surface.x_range[1]);
      }
    });

    it('should have valid obstacles', () => {
      expect(Array.isArray(canyonJson.obstacles)).toBe(true);
      const validTypes = ['box', 'circle'];

      for (const obstacle of canyonJson.obstacles) {
        expect(obstacle).toHaveProperty('type');
        expect(validTypes).toContain(obstacle.type);
        expect(Array.isArray(obstacle.pos)).toBe(true);
        expect(obstacle.pos).toHaveLength(2);
      }
    });

    it('should have valid zones', () => {
      expect(Array.isArray(canyonJson.zones)).toBe(true);

      for (const zone of canyonJson.zones) {
        expect(zone).toHaveProperty('id');
        expect(typeof zone.id).toBe('string');
        expect(typeof zone.x_start).toBe('number');
        expect(typeof zone.x_end).toBe('number');
        expect(zone.x_start).toBeLessThan(zone.x_end);
      }
    });

    it('should have valid start position', () => {
      expect(canyonJson.start).toHaveProperty('pos');
      expect(Array.isArray(canyonJson.start.pos)).toBe(true);
      expect(canyonJson.start.pos).toHaveLength(2);
      expect(canyonJson.start).toHaveProperty('facing', 1);
    });

    it('should have valid finish position', () => {
      expect(canyonJson.finish).toHaveProperty('pos');
      expect(Array.isArray(canyonJson.finish.pos)).toBe(true);
      expect(canyonJson.finish.pos).toHaveLength(2);
      expect(canyonJson.finish).toHaveProperty('width');
      expect(canyonJson.finish.width).toBeGreaterThan(0);
    });

    it('should have valid hazards', () => {
      expect(Array.isArray(canyonJson.hazards)).toBe(true);
      const validTypes = ['pit'];

      for (const hazard of canyonJson.hazards) {
        expect(hazard).toHaveProperty('type');
        expect(validTypes).toContain(hazard.type);
        expect(typeof hazard.x_start).toBe('number');
        expect(typeof hazard.x_end).toBe('number');
        expect(hazard.x_start).toBeLessThan(hazard.x_end);
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
      expect(result.valid).toBe(true);
    });

    it('should have no errors', () => {
      expect(result.errors).toEqual([]);
    });

    it('should have correct track identity', () => {
      expect(dunesJson).toHaveProperty('id', 'dunes-03');
      expect(dunesJson).toHaveProperty('numeric_id', 3);
      expect(dunesJson).toHaveProperty('name', 'Dune Drifter');
    });

    it('should be longer than canyon-02', () => {
      // dunes-03 is the longest track at 48m
      expect(dunesJson.terrain[dunesJson.terrain.length - 1][0]).toBe(48);
    });

    it('should have snow surface on final zone', () => {
      const snowSurface = dunesJson.surfaces?.find((s: any) => s.type === 'snow');
      expect(snowSurface).toBeDefined();
      expect(snowSurface.x_range[0]).toBe(38);
      expect(snowSurface.x_range[1]).toBe(48);
    });
  });

  describe('validation error cases', () => {
    it('should reject track missing required fields', () => {
      const invalidTrack = {
        id: 'test-01'
        // missing numeric_id, name, version, world, camera, terrain, start, finish
      };

      const result = validateTrack(invalidTrack, 'test-track.json');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('Missing required field'))).toBe(true);
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
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('numeric_id'))).toBe(true);
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
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('strictly increasing'))).toBe(true);
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
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('invalid type'))).toBe(true);
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
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('x_start') && e.includes('x_end'))).toBe(true);
    });
  });
});