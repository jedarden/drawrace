// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { encodeGhostBlob, decodeGhostBlobVertices, decodeGhostBlobFinishTime } from "./ghost-blob.js";
import { _resetForTesting } from "./player-identity.js";

const TEST_UUID = "550e8400-e29b-41d4-a716-446655440000";

const SAMPLE_INPUT = {
  trackId: 1,
  finishTimeMs: 12345,
  playerUuid: TEST_UUID,
  wheelVertices: [
    { x: 1.0, y: 0.0 },
    { x: 0.0, y: 1.0 },
    { x: -1.0, y: 0.0 },
    { x: 0.0, y: -1.0 },
  ],
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
      expect(decoded[i].x).toBeCloseTo(SAMPLE_INPUT.wheelVertices[i].x, 1);
      expect(decoded[i].y).toBeCloseTo(SAMPLE_INPUT.wheelVertices[i].y, 1);
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

  it("handles zero vertices", () => {
    const input = { ...SAMPLE_INPUT, wheelVertices: [] };
    const buf = encodeGhostBlob(input);
    const decoded = decodeGhostBlobVertices(buf);
    expect(decoded).toHaveLength(0);
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
    // Should not throw, and stroke count byte should be 255
    const view = new DataView(buf);
    // vertex count at offset 36
    const vertexCount = view.getUint8(36);
    // point count follows after vertices
    const pointCountOffset = 37 + vertexCount * 4;
    expect(view.getUint8(pointCountOffset)).toBe(255);
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
