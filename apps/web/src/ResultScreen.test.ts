// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { encodeWheelForShare, decodeWheelFromShare } from "./ResultScreen.js";
import { PHYSICS_VERSION } from "@drawrace/engine-core";

const SAMPLE_VERTICES = [
  { x: 1.0, y: 0.0 },
  { x: 0.0, y: 1.0 },
  { x: -1.0, y: 0.0 },
  { x: 0.0, y: -1.0 },
];

describe("ResultScreen share link version checking", () => {
  describe("encodeWheelForShare", () => {
    it("encodes wheel with physics version", () => {
      const encoded = encodeWheelForShare(SAMPLE_VERTICES, 1);
      const decoded = JSON.parse(atob(encoded));

      expect(decoded.pv).toBe(PHYSICS_VERSION);
      expect(decoded.v).toEqual(SAMPLE_VERTICES.map(p => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]));
      expect(decoded.t).toBe(1);
    });

    it("encodes vertices with 0.1 precision rounding", () => {
      const vertices = [
        { x: 1.234, y: 0.987 },
        { x: 0.456, y: 1.321 },
      ];
      const encoded = encodeWheelForShare(vertices, 2);
      const decoded = JSON.parse(atob(encoded));

      expect(decoded.v).toEqual([
        [1.2, 1.0], // rounded from 1.234, 0.987
        [0.5, 1.3], // rounded from 0.456, 1.321
      ]);
    });

    it("encodes track ID correctly", () => {
      const encoded = encodeWheelForShare(SAMPLE_VERTICES, 3);
      const decoded = JSON.parse(atob(encoded));

      expect(decoded.t).toBe(3);
    });
  });

  describe("decodeWheelFromShare", () => {
    it("decodes wheel with physics version", () => {
      const payload = {
        v: SAMPLE_VERTICES.map(p => [p.x, p.y]),
        t: 1,
        pv: PHYSICS_VERSION
      };
      const encoded = btoa(JSON.stringify(payload));
      const decoded = decodeWheelFromShare(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded?.vertices).toEqual(SAMPLE_VERTICES);
      expect(decoded?.trackId).toBe(1);
      expect(decoded?.physicsVersion).toBe(PHYSICS_VERSION);
    });

    it("returns null for invalid JSON", () => {
      const decoded = decodeWheelFromShare("invalid-base64!@#");
      expect(decoded).toBeNull();
    });

    it("returns null for malformed payload (missing vertices)", () => {
      const payload = { t: 1, pv: PHYSICS_VERSION };
      const encoded = btoa(JSON.stringify(payload));
      const decoded = decodeWheelFromShare(encoded);

      expect(decoded).toBeNull();
    });

    it("returns null for malformed payload (missing trackId)", () => {
      const payload = { v: SAMPLE_VERTICES.map(p => [p.x, p.y]), pv: PHYSICS_VERSION };
      const encoded = btoa(JSON.stringify(payload));
      const decoded = decodeWheelFromShare(encoded);

      expect(decoded).toBeNull();
    });

    it("handles legacy links without physics version (defaults to version 1)", () => {
      // Legacy format: no pv field
      const payload = {
        v: SAMPLE_VERTICES.map(p => [p.x, p.y]),
        t: 1
      };
      const encoded = btoa(JSON.stringify(payload));
      const decoded = decodeWheelFromShare(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded?.vertices).toEqual(SAMPLE_VERTICES);
      expect(decoded?.trackId).toBe(1);
      expect(decoded?.physicsVersion).toBe(1); // default to version 1
    });

    it("handles malformed vertex data gracefully", () => {
      const payload = {
        v: [[1, 2], [3, 4], "invalid", [5, 6]], // one entry is not an array
        t: 1,
        pv: PHYSICS_VERSION
      };
      const encoded = btoa(JSON.stringify(payload));
      const decoded = decodeWheelFromShare(encoded);

      // Should handle gracefully - either return null or skip malformed entries
      expect(decoded).not.toBeNull();
      if (decoded) {
        expect(decoded.vertices.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("version mismatch detection", () => {
    it("detects version mismatch when old version < current version", () => {
      const oldVersion = PHYSICS_VERSION - 1;
      const payload = {
        v: SAMPLE_VERTICES.map(p => [p.x, p.y]),
        t: 1,
        pv: oldVersion
      };
      const encoded = btoa(JSON.stringify(payload));
      const decoded = decodeWheelFromShare(encoded);

      expect(decoded?.physicsVersion).toBe(oldVersion);
      expect(decoded?.physicsVersion).not.toBe(PHYSICS_VERSION);

      // Simulate the check in App.tsx
      const hasVersionMismatch = decoded && decoded.physicsVersion !== PHYSICS_VERSION;
      expect(hasVersionMismatch).toBe(true);
    });

    it("allows version match", () => {
      const payload = {
        v: SAMPLE_VERTICES.map(p => [p.x, p.y]),
        t: 1,
        pv: PHYSICS_VERSION
      };
      const encoded = btoa(JSON.stringify(payload));
      const decoded = decodeWheelFromShare(encoded);

      expect(decoded?.physicsVersion).toBe(PHYSICS_VERSION);

      // Simulate the check in App.tsx
      const hasVersionMismatch = decoded && decoded.physicsVersion !== PHYSICS_VERSION;
      expect(hasVersionMismatch).toBe(false);
    });

    it("detects version mismatch when legacy link (version 1) vs current version 8", () => {
      // Legacy format: no pv field, defaults to version 1
      const payload = {
        v: SAMPLE_VERTICES.map(p => [p.x, p.y]),
        t: 1
      };
      const encoded = btoa(JSON.stringify(payload));
      const decoded = decodeWheelFromShare(encoded);

      expect(decoded?.physicsVersion).toBe(1);

      // If current version is 8, this should trigger mismatch
      const hasVersionMismatch = decoded && decoded.physicsVersion !== PHYSICS_VERSION;
      expect(hasVersionMismatch).toBe(PHYSICS_VERSION !== 1);
    });

    it("handles future version gracefully (newer than current)", () => {
      const futureVersion = PHYSICS_VERSION + 5;
      const payload = {
        v: SAMPLE_VERTICES.map(p => [p.x, p.y]),
        t: 1,
        pv: futureVersion
      };
      const encoded = btoa(JSON.stringify(payload));
      const decoded = decodeWheelFromShare(encoded);

      expect(decoded?.physicsVersion).toBe(futureVersion);

      // Simulate the check in App.tsx
      const hasVersionMismatch = decoded && decoded.physicsVersion !== PHYSICS_VERSION;
      expect(hasVersionMismatch).toBe(true);
    });
  });

  describe("round-trip encoding/decoding", () => {
    it("round-trips wheel data correctly", () => {
      const originalVertices = SAMPLE_VERTICES;
      const trackId = 2;

      const encoded = encodeWheelForShare(originalVertices, trackId);
      const decoded = decodeWheelFromShare(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded?.trackId).toBe(trackId);
      expect(decoded?.physicsVersion).toBe(PHYSICS_VERSION);

      // Vertices should match (accounting for rounding precision)
      expect(decoded?.vertices.length).toBe(originalVertices.length);
      for (let i = 0; i < originalVertices.length; i++) {
        expect(decoded?.vertices[i].x).toBeCloseTo(originalVertices[i].x, 1);
        expect(decoded?.vertices[i].y).toBeCloseTo(originalVertices[i].y, 1);
      }
    });

    it("round-trips with complex wheel shape", () => {
      const complexVertices = [
        { x: 2.5, y: 0.0 },
        { x: 2.0, y: 1.5 },
        { x: 1.0, y: 2.0 },
        { x: 0.0, y: 2.5 },
        { x: -1.0, y: 2.0 },
        { x: -2.0, y: 1.5 },
        { x: -2.5, y: 0.0 },
        { x: -2.0, y: -1.5 },
        { x: -1.0, y: -2.0 },
        { x: 0.0, y: -2.5 },
        { x: 1.0, y: -2.0 },
        { x: 2.0, y: -1.5 },
      ];

      const encoded = encodeWheelForShare(complexVertices, 3);
      const decoded = decodeWheelFromShare(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded?.vertices.length).toBe(complexVertices.length);
      expect(decoded?.trackId).toBe(3);
      expect(decoded?.physicsVersion).toBe(PHYSICS_VERSION);
    });
  });
});
