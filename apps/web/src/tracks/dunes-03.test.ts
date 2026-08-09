/**
 * Test suite for dunes-03.json track validation
 *
 * This test verifies that the Dune Drifter track file:
 * - Can be loaded and parsed without errors
 * - Contains all required fields
 * - Has valid terrain, surfaces, zones, and obstacle data
 * - Matches the expected track schema
 */

import { describe, it, expect } from 'vitest';
import dunes03 from '../../public/tracks/dunes-03.json';

describe('dunes-03.json track validation', () => {
  it('loads and parses without errors', () => {
    expect(dunes03).toBeDefined();
    expect(dunes03).not.toBeNull();
  });

  it('has all required top-level fields', () => {
    expect(dunes03).toHaveProperty('id');
    expect(dunes03).toHaveProperty('numeric_id');
    expect(dunes03).toHaveProperty('name');
    expect(dunes03).toHaveProperty('version');
    expect(dunes03).toHaveProperty('world');
    expect(dunes03).toHaveProperty('camera');
    expect(dunes03).toHaveProperty('terrain');
    expect(dunes03).toHaveProperty('start');
    expect(dunes03).toHaveProperty('finish');
    expect(dunes03).toHaveProperty('metadata');
  });

  it('has correct track metadata', () => {
    expect(dunes03.id).toBe('dunes-03');
    expect(dunes03.numeric_id).toBe(3);
    expect(dunes03.name).toBe('Dune Drifter');
    expect(dunes03.version).toBe(1);
  });

  it('has valid world configuration', () => {
    expect(dunes03.world.gravity).toEqual([0.0, 10.0]);
    expect(dunes03.world.pixelsPerMeter).toBe(30);
  });

  it('has valid camera configuration', () => {
    expect(dunes03.camera.followAxis).toBe('x');
    expect(dunes03.camera.deadzone).toEqual([120, 80]);
    expect(dunes03.camera.maxZoomOut).toBe(1.0);
  });

  it('has valid terrain data', () => {
    expect(Array.isArray(dunes03.terrain)).toBe(true);
    expect(dunes03.terrain.length).toBeGreaterThan(0);

    // Verify each terrain point is [x, y] coordinate pair
    dunes03.terrain.forEach((point, index) => {
      expect(Array.isArray(point)).toBe(true);
      expect(point).toHaveLength(2);
      expect(typeof point[0]).toBe('number');
      expect(typeof point[1]).toBe('number');
    });
  });

  it('has terrain points in strictly increasing X order', () => {
    for (let i = 1; i < dunes03.terrain.length; i++) {
      expect(dunes03.terrain[i][0]).toBeGreaterThan(dunes03.terrain[i - 1][0]);
    }
  });

  it('has valid zones', () => {
    expect(Array.isArray(dunes03.zones)).toBe(true);

    dunes03.zones.forEach(zone => {
      expect(zone).toHaveProperty('id');
      expect(zone).toHaveProperty('x_start');
      expect(zone).toHaveProperty('x_end');
      expect(typeof zone.id).toBe('string');
      expect(typeof zone.x_start).toBe('number');
      expect(typeof zone.x_end).toBe('number');
      expect(zone.x_end).toBeGreaterThan(zone.x_start);
    });
  });

  it('has all five expected zones', () => {
    expect(dunes03.zones).toHaveLength(5);
    expect(dunes03.zones[0].id).toBe('A');
    expect(dunes03.zones[1].id).toBe('B');
    expect(dunes03.zones[2].id).toBe('C');
    expect(dunes03.zones[3].id).toBe('D');
    expect(dunes03.zones[4].id).toBe('E');
  });

  it('has valid surfaces', () => {
    expect(Array.isArray(dunes03.surfaces)).toBe(true);

    const validSurfaceTypes = ['normal', 'ice', 'snow', 'water', 'mud', 'rock'];

    dunes03.surfaces.forEach(surface => {
      expect(surface).toHaveProperty('x_range');
      expect(surface).toHaveProperty('type');
      expect(Array.isArray(surface.x_range)).toBe(true);
      expect(surface.x_range).toHaveLength(2);
      expect(validSurfaceTypes).toContain(surface.type);
    });
  });

  it('has expected surface types across zones', () => {
    const surfaces = dunes03.surfaces;
    expect(surfaces).toHaveLength(6);

    // Zone A (0-8m): normal warmup
    expect(surfaces[0]).toMatchObject({ x_range: [0, 8], type: 'normal' });

    // Zone B (8-22m): water crossing then normal
    expect(surfaces[1]).toMatchObject({ x_range: [8, 14], type: 'water' });
    expect(surfaces[2]).toMatchObject({ x_range: [14, 22], type: 'normal' });

    // Zone C (22-30m): rock surface uphill ramp
    expect(surfaces[3]).toMatchObject({ x_range: [22, 30], type: 'rock' });

    // Zone D (30-38m): ice technical section
    expect(surfaces[4]).toMatchObject({ x_range: [30, 38], type: 'ice' });

    // Zone E (38-48m): snow finish stretch
    expect(surfaces[5]).toMatchObject({ x_range: [38, 48], type: 'snow' });
  });

  it('has valid obstacles', () => {
    expect(Array.isArray(dunes03.obstacles)).toBe(true);

    dunes03.obstacles.forEach(obstacle => {
      expect(obstacle).toHaveProperty('type');
      expect(obstacle).toHaveProperty('pos');
      expect(['box', 'circle']).toContain(obstacle.type);
      expect(Array.isArray(obstacle.pos)).toBe(true);
      expect(obstacle.pos).toHaveLength(2);
    });
  });

  it('has three box obstacles in ice zone', () => {
    expect(dunes03.obstacles).toHaveLength(3);

    // All obstacles should be boxes in the ice zone (30-38m)
    dunes03.obstacles.forEach(obstacle => {
      expect(obstacle.type).toBe('box');
      expect(obstacle.pos[0]).toBeGreaterThanOrEqual(30);
      expect(obstacle.pos[0]).toBeLessThanOrEqual(38);
    });
  });

  it('has valid ramps', () => {
    expect(Array.isArray(dunes03.ramps)).toBe(true);

    if (dunes03.ramps.length > 0) {
      dunes03.ramps.forEach(ramp => {
        expect(ramp).toHaveProperty('zone');
        expect(ramp).toHaveProperty('x_start');
        expect(ramp).toHaveProperty('x_end');
        expect(typeof ramp.zone).toBe('string');
        expect(typeof ramp.x_start).toBe('number');
        expect(typeof ramp.x_end).toBe('number');
      });
    }
  });

  it('has ramp in Zone C for uphill climb', () => {
    expect(dunes03.ramps).toHaveLength(1);
    expect(dunes03.ramps[0]).toMatchObject({
      zone: 'C',
      x_start: 25,
      x_end: 30
    });
  });

  it('has valid hazards', () => {
    expect(Array.isArray(dunes03.hazards)).toBe(true);

    if (dunes03.hazards.length > 0) {
      dunes03.hazards.forEach(hazard => {
        expect(hazard).toHaveProperty('type');
        expect(hazard).toHaveProperty('x_start');
        expect(hazard).toHaveProperty('x_end');
        expect(['pit', 'water']).toContain(hazard.type);
      });
    }
  });

  it('has pit hazard in Zone B', () => {
    expect(dunes03.hazards).toHaveLength(1);
    expect(dunes03.hazards[0]).toMatchObject({
      type: 'pit',
      x_start: 19,
      x_end: 22
    });
  });

  it('has valid start position', () => {
    expect(dunes03.start).toHaveProperty('pos');
    expect(dunes03.start).toHaveProperty('facing');
    expect(Array.isArray(dunes03.start.pos)).toBe(true);
    expect(dunes03.start.pos).toHaveLength(2);
    expect([1, -1]).toContain(dunes03.start.facing);
  });

  it('has valid finish position', () => {
    expect(dunes03.finish).toHaveProperty('pos');
    expect(dunes03.finish).toHaveProperty('width');
    expect(Array.isArray(dunes03.finish.pos)).toBe(true);
    expect(dunes03.finish.pos).toHaveLength(2);
    expect(typeof dunes03.finish.width).toBe('number');
    expect(dunes03.finish.width).toBeGreaterThan(0);
  });

  it('has valid metadata', () => {
    expect(dunes03.metadata).toHaveProperty('targetTimeSeconds');
    expect(dunes03.metadata).toHaveProperty('tutorialGhosts');
    expect(typeof dunes03.metadata.targetTimeSeconds).toBe('number');
    expect(Array.isArray(dunes03.metadata.tutorialGhosts)).toBe(true);
  });

  it('track spans expected distance', () => {
    const lastPoint = dunes03.terrain[dunes03.terrain.length - 1];
    expect(lastPoint[0]).toBe(48); // 48 meters long (longest of the three tracks)
  });

  it('start position is above terrain', () => {
    const startX = dunes03.start.pos[0];
    const startY = dunes03.start.pos[1];

    // Interpolate terrain Y at start X
    const terrain = dunes03.terrain;
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
    if (dunes03.surfaces.length > 0) {
      // Sort surfaces by x_range start
      const sortedSurfaces = [...dunes03.surfaces].sort((a, b) => a.x_range[0] - b.x_range[0]);

      // Check that each surface starts where the previous ended (or at 0)
      expect(sortedSurfaces[0].x_range[0]).toBe(0);

      for (let i = 1; i < sortedSurfaces.length; i++) {
        const prevEnd = sortedSurfaces[i - 1].x_range[1];
        const currStart = sortedSurfaces[i].x_range[0];
        expect(currStart).toBe(prevEnd);
      }
    }
  });

  it('zones tile the track without gaps', () => {
    if (dunes03.zones.length > 0) {
      // Sort zones by x_start
      const sortedZones = [...dunes03.zones].sort((a, b) => a.x_start - b.x_start);

      // Check that each zone starts where the previous ended (or at 0)
      expect(sortedZones[0].x_start).toBe(0);

      for (let i = 1; i < sortedZones.length; i++) {
        const prevEnd = sortedZones[i - 1].x_end;
        const currStart = sortedZones[i].x_start;
        expect(currStart).toBe(prevEnd);
      }

      // Last zone should end at track finish
      const lastZoneEnd = sortedZones[sortedZones.length - 1].x_end;
      const trackLength = dunes03.terrain[dunes03.terrain.length - 1][0];
      expect(lastZoneEnd).toBe(trackLength);
    }
  });
});
