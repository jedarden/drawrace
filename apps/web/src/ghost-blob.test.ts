// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { encodeGhostBlob, decodeGhostBlobVertices, decodeGhostBlobFinishTime, decodeGhostBlobWheels, encodeGhostForShare, decodeGhostForShare } from "./ghost-blob.js";
import { _resetForTesting } from "./player-identity.js";
import { PHYSICS_VERSION } from "@drawrace/engine-core";
import type { WheelSwap } from "./ghost-blob.js";

const TEST_UUID = "550e8400-e29b-41d4-a716-446655440000";

const SAMPLE_VERTICES = [
  { x: 1.0, y: 0.0 },
  { x: 0.0, y: 1.0 },
  { x: -1.0, y: 0.0 },
  { x: 0.0, y: -1.0 },
];

const SAMPLE_INPUT = {
  trackId: 1,
  finishTimeMs: 12345,
  playerUuid: TEST_UUID,
  wheels: [{ swapTick: 0, vertices: SAMPLE_VERTICES }] as WheelSwap[],
  rawStrokePoints: [
    { x: 0, y: 0, t: 0 },
    { x: 10, y: 5, t: 100 },
    { x: 20, y: 10, t: 200 },
  ],
};

describe("ghost-blob (Layer 1)", () => {
  it("encodes with DRGH magic", () => {
    const buf = encodeGhostBlob(SAMPLE_INPUT);
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0x44); // D
    expect(bytes[1]).toBe(0x52); // R
    expect(bytes[2]).toBe(0x47); // G
    expect(bytes[3]).toBe(0x48); // H
  });

  it("round-trips vertices through encode/decode", () => {
    const buf = encodeGhostBlob(SAMPLE_INPUT);
    const decoded = decodeGhostBlobVertices(buf);
    expect(decoded).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(decoded[i].x).toBeCloseTo(SAMPLE_VERTICES[i].x, 1);
      expect(decoded[i].y).toBeCloseTo(SAMPLE_VERTICES[i].y, 1);
    }
  });

  it("round-trips finish time through encode/decode", () => {
    const buf = encodeGhostBlob(SAMPLE_INPUT);
    const decodedTime = decodeGhostBlobFinishTime(buf);
    expect(decodedTime).toBe(12345);
  });

  it("encodes track id", () => {
    const buf = encodeGhostBlob(SAMPLE_INPUT);
    const view = new DataView(buf);
    expect(view.getUint16(5, true)).toBe(1);
  });

  it("encodes wheel_count at offset 36", () => {
    const buf = encodeGhostBlob(SAMPLE_INPUT);
    const view = new DataView(buf);
    expect(view.getUint8(36)).toBe(1);
  });

  it("encodes swap_tick for first wheel as 0", () => {
    const buf = encodeGhostBlob(SAMPLE_INPUT);
    const view = new DataView(buf);
    expect(view.getUint32(37, true)).toBe(0);
  });

  it("round-trips a 5-swap blob", () => {
    const wheels: WheelSwap[] = [{ swapTick: 0, vertices: SAMPLE_VERTICES }];
    for (let i = 1; i <= 5; i++) {
      wheels.push({
        swapTick: i * 60, // 60 tick gaps
        vertices: SAMPLE_VERTICES.map((v) => ({ x: v.x + i * 0.1, y: v.y })),
      });
    }
    const input = { ...SAMPLE_INPUT, wheels };
    const buf = encodeGhostBlob(input);
    const view = new DataView(buf);

    // wheel_count
    expect(view.getUint8(36)).toBe(6);

    // decode first wheel
    const decoded = decodeGhostBlobVertices(buf);
    expect(decoded).toHaveLength(4);
    expect(decoded[0].x).toBeCloseTo(1.0, 1);
  });

  it("encodes a 20-swap blob (21 wheels)", () => {
    const wheels: WheelSwap[] = [{ swapTick: 0, vertices: SAMPLE_VERTICES }];
    for (let i = 1; i <= 20; i++) {
      wheels.push({
        swapTick: i * 60,
        vertices: SAMPLE_VERTICES,
      });
    }
    const input = { ...SAMPLE_INPUT, wheels };
    const buf = encodeGhostBlob(input);
    const view = new DataView(buf);
    expect(view.getUint8(36)).toBe(21);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("handles zero stroke points", () => {
    const input = { ...SAMPLE_INPUT, rawStrokePoints: [] };
    const buf = encodeGhostBlob(input);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("clamps stroke points to 255", () => {
    const points = Array.from({ length: 300 }, (_, i) => ({
      x: i, y: i, t: i * 10,
    }));
    const input = { ...SAMPLE_INPUT, rawStrokePoints: points };
    const buf = encodeGhostBlob(input);
    const view = new DataView(buf);
    // wheel_count at offset 36
    const wheelCount = view.getUint8(36);
    // skip wheels[] to find point_count
    let offset = 37;
    for (let w = 0; w < wheelCount; w++) {
      offset += 4; // swap_tick
      const vc = view.getUint8(offset);
      offset += 1 + vc * 4;
    }
    expect(view.getUint8(offset)).toBe(255);
  });

  it("sets flags bit 0x02 when ephemeral", () => {
    _resetForTesting();
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    vi.spyOn(localStorage, "removeItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    const buf = encodeGhostBlob(SAMPLE_INPUT);
    const view = new DataView(buf);
    expect(view.getUint8(7)).toBe(0x02);
    vi.restoreAllMocks();
  });

  it("sets flags to 0x00 when not ephemeral", () => {
    _resetForTesting();
    const buf = encodeGhostBlob(SAMPLE_INPUT);
    const view = new DataView(buf);
    expect(view.getUint8(7)).toBe(0x00);
  });

  describe("decodeGhostBlobWheels", () => {
    it("decodes a single-wheel blob", () => {
      const buf = encodeGhostBlob(SAMPLE_INPUT);
      const wheels = decodeGhostBlobWheels(buf);
      expect(wheels).toHaveLength(1);
      expect(wheels[0].swapTick).toBe(0);
      expect(wheels[0].vertices).toHaveLength(4);
      expect(wheels[0].vertices[0].x).toBeCloseTo(1.0, 1);
      expect(wheels[0].vertices[0].y).toBeCloseTo(0.0, 1);
    });

    it("decodes a multi-wheel blob with 3 swaps", () => {
      const wheels: WheelSwap[] = [
        { swapTick: 0, vertices: SAMPLE_VERTICES },
        { swapTick: 300, vertices: SAMPLE_VERTICES.map((v) => ({ x: v.x + 0.5, y: v.y })) },
        { swapTick: 600, vertices: SAMPLE_VERTICES.map((v) => ({ x: v.x - 0.5, y: v.y })) },
      ];
      const input = { ...SAMPLE_INPUT, wheels };
      const buf = encodeGhostBlob(input);
      const decoded = decodeGhostBlobWheels(buf);

      expect(decoded).toHaveLength(3);
      expect(decoded[0].swapTick).toBe(0);
      expect(decoded[1].swapTick).toBe(300);
      expect(decoded[2].swapTick).toBe(600);
      expect(decoded[1].vertices[0].x).toBeCloseTo(1.5, 1);
      expect(decoded[2].vertices[0].x).toBeCloseTo(0.5, 1);
    });

    it("decodes a 20-swap blob", () => {
      const wheels: WheelSwap[] = [{ swapTick: 0, vertices: SAMPLE_VERTICES }];
      for (let i = 1; i <= 20; i++) {
        wheels.push({
          swapTick: i * 60,
          vertices: SAMPLE_VERTICES.map((v) => ({ x: v.x + i * 0.1, y: v.y })),
        });
      }
      const input = { ...SAMPLE_INPUT, wheels };
      const buf = encodeGhostBlob(input);
      const decoded = decodeGhostBlobWheels(buf);

      expect(decoded).toHaveLength(21);
      expect(decoded[0].swapTick).toBe(0);
      expect(decoded[20].swapTick).toBe(1200);
      expect(decoded[20].vertices[0].x).toBeCloseTo(1.0 + 20 * 0.1, 1);
    });
  });
});

describe("ghost-blob share link version checking", () => {
  const SAMPLE_WHEELS: WheelSwap[] = [
    { swapTick: 0, vertices: SAMPLE_VERTICES },
    { swapTick: 300, vertices: SAMPLE_VERTICES.map((v) => ({ x: v.x + 0.5, y: v.y })) },
  ];

  describe("encodeGhostForShare", () => {
    it("encodes ghost with physics version", () => {
      const input = {
        trackId: 1,
        finishTimeMs: 25000,
        seed: 12345,
        wheels: SAMPLE_WHEELS,
      };
      const encoded = encodeGhostForShare(input);
      const decoded = decodeGhostForShare(encoded);

      expect(decoded?.physicsVersion).toBe(PHYSICS_VERSION);
      expect(decoded?.trackId).toBe(1);
      expect(decoded?.finishTimeMs).toBe(25000);
      expect(decoded?.seed).toBe(12345);
      expect(decoded?.wheels).toHaveLength(2);
    });

    it("encodes multiple wheel swaps correctly", () => {
      const wheels: WheelSwap[] = [
        { swapTick: 0, vertices: SAMPLE_VERTICES },
        { swapTick: 120, vertices: SAMPLE_VERTICES.map((v) => ({ x: v.x + 0.2, y: v.y })) },
        { swapTick: 480, vertices: SAMPLE_VERTICES.map((v) => ({ x: v.x - 0.3, y: v.y })) },
      ];
      const input = { trackId: 2, finishTimeMs: 30000, seed: 54321, wheels };
      const encoded = encodeGhostForShare(input);
      const decoded = decodeGhostForShare(encoded);

      expect(decoded?.wheels).toHaveLength(3);
      expect(decoded?.wheels[0].swapTick).toBe(0);
      expect(decoded?.wheels[1].swapTick).toBe(120);
      expect(decoded?.wheels[2].swapTick).toBe(480);
    });
  });

  describe("decodeGhostForShare", () => {
    it("decodes ghost with physics version", () => {
      const input = {
        trackId: 1,
        finishTimeMs: 25000,
        seed: 12345,
        wheels: SAMPLE_WHEELS,
      };
      const encoded = encodeGhostForShare(input);
      const decoded = decodeGhostForShare(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded?.trackId).toBe(1);
      expect(decoded?.finishTimeMs).toBe(25000);
      expect(decoded?.seed).toBe(12345);
      expect(decoded?.wheels).toHaveLength(2);
      expect(decoded?.physicsVersion).toBe(PHYSICS_VERSION);
    });

    it("returns null for invalid base64", () => {
      const decoded = decodeGhostForShare("invalid-base64!@#$");
      expect(decoded).toBeNull();
    });

    it("returns null for wrong magic number", () => {
      // Create a buffer with wrong magic
      const buf = new ArrayBuffer(10);
      const bytes = new Uint8Array(buf);
      bytes[0] = 0x42; // Wrong magic
      bytes[1] = 0x41;
      bytes[2] = 0x44;
      bytes[3] = 0x47;
      const base64 = btoa(String.fromCharCode(...bytes));
      const urlSafe = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      const decoded = decodeGhostForShare(urlSafe);
      expect(decoded).toBeNull();
    });

    it("handles malformed wheel data gracefully", () => {
      // This tests that corrupt wheel data doesn't crash the decoder
      const input = {
        trackId: 1,
        finishTimeMs: 25000,
        seed: 12345,
        wheels: SAMPLE_WHEELS,
      };
      const encoded = encodeGhostForShare(input);

      // Corrupt the base64 string more severely - replace part with invalid chars
      const corrupted = encoded.substring(0, Math.floor(encoded.length / 2)) + '!@#$%invalid' + encoded.substring(Math.floor(encoded.length / 2) + 1);

      const decoded = decodeGhostForShare(corrupted);
      // Should return null for severely corrupted data
      expect(decoded).toBeNull();
    });
  });

  describe("ghost share version mismatch detection", () => {
    it("detects version mismatch when old version < current version", () => {
      // Create a ghost share with an old physics version
      const input = {
        trackId: 1,
        finishTimeMs: 25000,
        seed: 12345,
        wheels: SAMPLE_WHEELS,
      };
      const encoded = encodeGhostForShare(input);

      // Manually corrupt the version byte to simulate old version
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      // Set version to PHYSICS_VERSION - 2 (at offset 4, after magic)
      const oldVersion = PHYSICS_VERSION - 2;
      bytes[4] = oldVersion;

      // Re-encode
      const newBase64 = btoa(String.fromCharCode(...bytes));
      const urlSafe = newBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      const decoded = decodeGhostForShare(urlSafe);
      expect(decoded?.physicsVersion).toBe(oldVersion);
      expect(decoded?.physicsVersion).not.toBe(PHYSICS_VERSION);

      // Simulate the check in App.tsx
      const hasVersionMismatch = decoded && decoded.physicsVersion !== PHYSICS_VERSION;
      expect(hasVersionMismatch).toBe(true);
    });

    it("allows version match", () => {
      const input = {
        trackId: 1,
        finishTimeMs: 25000,
        seed: 12345,
        wheels: SAMPLE_WHEELS,
      };
      const encoded = encodeGhostForShare(input);
      const decoded = decodeGhostForShare(encoded);

      expect(decoded?.physicsVersion).toBe(PHYSICS_VERSION);

      // Simulate the check in App.tsx
      const hasVersionMismatch = decoded && decoded.physicsVersion !== PHYSICS_VERSION;
      expect(hasVersionMismatch).toBe(false);
    });

    it("detects version mismatch when legacy version 1 vs current version 8", () => {
      // Manually create a share with version 1
      const input = {
        trackId: 1,
        finishTimeMs: 25000,
        seed: 12345,
        wheels: SAMPLE_WHEELS,
      };
      const encoded = encodeGhostForShare(input);

      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      // Set version to 1 (legacy)
      bytes[4] = 1;

      // Re-encode
      const newBase64 = btoa(String.fromCharCode(...bytes));
      const urlSafe = newBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      const decoded = decodeGhostForShare(urlSafe);
      expect(decoded?.physicsVersion).toBe(1);

      // If current version is 8, this should trigger mismatch
      const hasVersionMismatch = decoded && decoded.physicsVersion !== PHYSICS_VERSION;
      expect(hasVersionMismatch).toBe(PHYSICS_VERSION !== 1);
    });

    it("handles future version gracefully (newer than current)", () => {
      const input = {
        trackId: 1,
        finishTimeMs: 25000,
        seed: 12345,
        wheels: SAMPLE_WHEELS,
      };
      const encoded = encodeGhostForShare(input);

      // Manually set version to future
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      // Set version to PHYSICS_VERSION + 5
      const futureVersion = PHYSICS_VERSION + 5;
      bytes[4] = futureVersion;

      // Re-encode
      const newBase64 = btoa(String.fromCharCode(...bytes));
      const urlSafe = newBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      const decoded = decodeGhostForShare(urlSafe);
      expect(decoded?.physicsVersion).toBe(futureVersion);

      // Simulate the check in App.tsx
      const hasVersionMismatch = decoded && decoded.physicsVersion !== PHYSICS_VERSION;
      expect(hasVersionMismatch).toBe(true);
    });

    it("extracts fromVersion for UI display", () => {
      const oldVersion = PHYSICS_VERSION - 3;
      const input = {
        trackId: 1,
        finishTimeMs: 25000,
        seed: 12345,
        wheels: SAMPLE_WHEELS,
      };
      const encoded = encodeGhostForShare(input);

      // Manually set version
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      bytes[4] = oldVersion;

      const newBase64 = btoa(String.fromCharCode(...bytes));
      const urlSafe = newBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      const decoded = decodeGhostForShare(urlSafe);

      // This tests that we can extract the fromVersion for the UI message
      expect(decoded?.physicsVersion).toBe(oldVersion);
      expect(decoded?.physicsVersion).toBeLessThan(PHYSICS_VERSION);

      // Simulate the UI check
      if (decoded && decoded.physicsVersion !== PHYSICS_VERSION) {
        const fromVersion = decoded.physicsVersion;
        expect(fromVersion).toBeDefined();
        expect(fromVersion).toBe(oldVersion);
      }
    });
  });

  describe("round-trip ghost share encoding/decoding", () => {
    it("round-trips ghost data correctly", () => {
      const originalWheels: WheelSwap[] = [
        { swapTick: 0, vertices: SAMPLE_VERTICES },
        { swapTick: 180, vertices: SAMPLE_VERTICES.map((v) => ({ x: v.x + 0.3, y: v.y })) },
        { swapTick: 420, vertices: SAMPLE_VERTICES.map((v) => ({ x: v.x - 0.2, y: v.y + 0.1 })) },
      ];

      const input = {
        trackId: 2,
        finishTimeMs: 28500,
        seed: 99999,
        wheels: originalWheels,
      };

      const encoded = encodeGhostForShare(input);
      const decoded = decodeGhostForShare(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded?.trackId).toBe(2);
      expect(decoded?.finishTimeMs).toBe(28500);
      expect(decoded?.seed).toBe(99999);
      expect(decoded?.physicsVersion).toBe(PHYSICS_VERSION);
      expect(decoded?.wheels).toHaveLength(3);

      // Check wheels match
      for (let i = 0; i < originalWheels.length; i++) {
        expect(decoded?.wheels[i].swapTick).toBe(originalWheels[i].swapTick);
        expect(decoded?.wheels[i].vertices.length).toBe(originalWheels[i].vertices.length);

        // Check vertex precision (within rounding tolerance)
        for (let j = 0; j < originalWheels[i].vertices.length; j++) {
          expect(decoded?.wheels[i].vertices[j].x).toBeCloseTo(originalWheels[i].vertices[j].x, 1);
          expect(decoded?.wheels[i].vertices[j].y).toBeCloseTo(originalWheels[i].vertices[j].y, 1);
        }
      }
    });

    it("round-trips with maximum swap count (20 swaps)", () => {
      const wheels: WheelSwap[] = [{ swapTick: 0, vertices: SAMPLE_VERTICES }];
      for (let i = 1; i <= 20; i++) {
        wheels.push({
          swapTick: i * 60,
          vertices: SAMPLE_VERTICES.map((v) => ({ x: v.x + i * 0.05, y: v.y })),
        });
      }

      const input = {
        trackId: 3,
        finishTimeMs: 35000,
        seed: 77777,
        wheels,
      };

      const encoded = encodeGhostForShare(input);
      const decoded = decodeGhostForShare(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded?.wheels).toHaveLength(21); // Initial + 20 swaps
      expect(decoded?.wheels[0].swapTick).toBe(0);
      expect(decoded?.wheels[20].swapTick).toBe(1200);
    });
  });
});
