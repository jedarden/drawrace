// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { encodeGhostBlob, decodeGhostBlobVertices, decodeGhostBlobFinishTime } from "./ghost-blob.js";
import { _resetForTesting } from "./player-identity.js";
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
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
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
});
