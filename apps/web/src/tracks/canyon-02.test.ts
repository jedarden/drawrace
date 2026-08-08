/**
 * Test suite for canyon-02.json track validation
 *
 * This test verifies that the Canyon Run track file:
 * - Can be loaded and parsed without errors
 * - Contains all required fields
 * - Has valid terrain, surfaces, zones, and obstacle data
 * - Matches the expected track schema
 */

import { describe, it, expect } from 'vitest';
import canyon02 from '../../public/tracks/canyon-02.json';

describe('canyon-02.json track validation', () => {
  it('loads and parses without errors', () => {
    expect(canyon02).toBeDefined();
    expect(canyon02).not.toBeNull();
  });

  it('has all required top-level fields', () => {
    expect(canyon02).toHaveProperty('id');
    expect(canyon02).toHaveProperty('numeric_id');
    expect(canyon02).toHaveProperty('name');
    expect(canyon02).toHaveProperty('version');
    expect(canyon02).toHaveProperty('world');
    expect(canyon02).toHaveProperty('camera');
    expect(canyon02).toHaveProperty('terrain');
    expect(canyon02).toHaveProperty('start');
    expect(canyon02).toHaveProperty('finish');
    expect(canyon02).toHaveProperty('metadata');
  });

  it('has correct track metadata', () => {
    expect(canyon02.id).toBe('canyon-02');
    expect(canyon02.numeric_id).toBe(2);
    expect(canyon02.name).toBe('Canyon Run');
    expect(canyon02.version).toBe(1);
  });

  it('has valid world configuration', () => {
    expect(canyon02.world.gravity).toEqual([0.0, 10.0]);
    expect(canyon02.world.pixelsPerMeter).toBe(30);
  });

  it('has valid camera configuration', () => {
    expect(canyon02.camera.followAxis).toBe('x');
    expect(canyon02.camera.deadzone).toEqual([120, 80]);
    expect(canyon02.camera.maxZoomOut).toBe(1.0);
  });

  it('has valid terrain data', () => {
    expect(Array.isArray(canyon02.terrain)).toBe(true);
    expect(canyon02.terrain.length).toBeGreaterThan(0);

    // Verify each terrain point is [x, y] coordinate pair
    canyon02.terrain.forEach((point, index) => {
      expect(Array.isArray(point)).toBe(true);
      expect(point).toHaveLength(2);
      expect(typeof point[0]).toBe('number');
      expect(typeof point[1]).toBe('number');
    });
  });

  it('has terrain points in strictly increasing X order', () => {
    for (let i = 1; i < canyon02.terrain.length; i++) {
      expect(canyon02.terrain[i][0]).toBeGreaterThan(canyon02.terrain[i - 1][0]);
    }
  });

  it('has valid zones', () => {
    expect(Array.isArray(canyon02.zones)).toBe(true);

    canyon02.zones.forEach(zone => {
      expect(zone).toHaveProperty('id');
      expect(zone).toHaveProperty('x_start');
      expect(zone).toHaveProperty('x_end');
      expect(typeof zone.id).toBe('string');
      expect(typeof zone.x_start).toBe('number');
      expect(typeof zone.x_end).toBe('number');
      expect(zone.x_end).toBeGreaterThan(zone.x_start);
    });
  });

  it('has valid surfaces', () => {
    expect(Array.isArray(canyon02.surfaces)).toBe(true);

    const validSurfaceTypes = ['normal', 'ice', 'snow', 'water', 'mud', 'rock'];

    canyon02.surfaces.forEach(surface => {
      expect(surface).toHaveProperty('x_range');
      expect(surface).toHaveProperty('type');
      expect(Array.isArray(surface.x_range)).toBe(true);
      expect(surface.x_range).toHaveLength(2);
      expect(validSurfaceTypes).toContain(surface.type);
    });
  });

  it('has valid obstacles', () => {
    expect(Array.isArray(canyon02.obstacles)).toBe(true);

    canyon02.obstacles.forEach(obstacle => {
      expect(obstacle).toHaveProperty('type');
      expect(obstacle).toHaveProperty('pos');
      expect(['box', 'circle']).toContain(obstacle.type);
      expect(Array.isArray(obstacle.pos)).toBe(true);
      expect(obstacle.pos).toHaveLength(2);
    });
  });

  it('has valid ramps', () => {
    expect(Array.isArray(canyon02.ramps)).toBe(true);

    if (canyon02.ramps.length > 0) {
      canyon02.ramps.forEach(ramp => {
        expect(ramp).toHaveProperty('x_start');
        expect(ramp).toHaveProperty('x_end');
        expect(typeof ramp.x_start).toBe('number');
        expect(typeof ramp.x_end).toBe('number');
      });
    }
  });

  it('has valid hazards', () => {
    expect(Array.isArray(canyon02.hazards)).toBe(true);

    if (canyon02.hazards.length > 0) {
      canyon02.hazards.forEach(hazard => {
        expect(hazard).toHaveProperty('type');
        expect(hazard).toHaveProperty('x_start');
        expect(hazard).toHaveProperty('x_end');
        expect(['pit', 'water']).toContain(hazard.type);
      });
    }
  });

  it('has valid start position', () => {
    expect(canyon02.start).toHaveProperty('pos');
    expect(canyon02.start).toHaveProperty('facing');
    expect(Array.isArray(canyon02.start.pos)).toBe(true);
    expect(canyon02.start.pos).toHaveLength(2);
    expect([1, -1]).toContain(canyon02.start.facing);
  });

  it('has valid finish position', () => {
    expect(canyon02.finish).toHaveProperty('pos');
    expect(canyon02.finish).toHaveProperty('width');
    expect(Array.isArray(canyon02.finish.pos)).toBe(true);
    expect(canyon02.finish.pos).toHaveLength(2);
    expect(typeof canyon02.finish.width).toBe('number');
    expect(canyon02.finish.width).toBeGreaterThan(0);
  });

  it('has valid metadata', () => {
    expect(canyon02.metadata).toHaveProperty('targetTimeSeconds');
    expect(canyon02.metadata).toHaveProperty('tutorialGhosts');
    expect(typeof canyon02.metadata.targetTimeSeconds).toBe('number');
    expect(Array.isArray(canyon02.metadata.tutorialGhosts)).toBe(true);
  });

  it('track spans expected distance', () => {
    const lastPoint = canyon02.terrain[canyon02.terrain.length - 1];
    expect(lastPoint[0]).toBe(40); // 40 meters long
  });

  it('start position is above terrain', () => {
    const startX = canyon02.start.pos[0];
    const startY = canyon02.start.pos[1];

    // Interpolate terrain Y at start X
    const terrain = canyon02.terrain;
    let terrainY = null;

    for (let i = 0; i < terrain.length - 1; i++) {
      const [x0, y0] = terrain[i];
      const [x1, y1] = terrain[i + 1];

      if (startX >= x0 && startX <= x1) {
        const t = (startX - x0) / (x1 - x0);
        terrainY = y0 + t * (y1 - y0);
        break;
      }
    }

    expect(terrainY).not.toBeNull();

    // Car should spawn above road (lower Y value in Y-down coordinate system)
    if (terrainY !== null) {
      expect(startY).toBeLessThan(terrainY);
    }
  });

  it('surfaces tile the track without gaps', () => {
    if (canyon02.surfaces.length > 0) {
      // Sort surfaces by x_range start
      const sortedSurfaces = [...canyon02.surfaces].sort((a, b) => a.x_range[0] - b.x_range[0]);

      // Check that each surface starts where the previous ended (or at 0)
      expect(sortedSurfaces[0].x_range[0]).toBe(0);

      for (let i = 1; i < sortedSurfaces.length; i++) {
        const prevEnd = sortedSurfaces[i - 1].x_range[1];
        const currStart = sortedSurfaces[i].x_range[0];
        expect(currStart).toBe(prevEnd);
      }
    }
  });
});
