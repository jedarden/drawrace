import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateUUID } from "./player-identity";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("generateUUID", () => {
  it("returns a valid v4 UUID via crypto.randomUUID when available", () => {
    const id = generateUUID();
    expect(id).toMatch(UUID_V4_RE);
  });

  it("returns a valid v4 UUID via getRandomValues when randomUUID is unavailable", () => {
    const original = crypto.randomUUID;
    try {
      // @ts-expect-error intentionally remove randomUUID to simulate non-secure context
      crypto.randomUUID = undefined;
      const id = generateUUID();
      expect(id).toMatch(UUID_V4_RE);
    } finally {
      crypto.randomUUID = original;
    }
  });

  it("polyfill path produces unique values", () => {
    const original = crypto.randomUUID;
    try {
      // @ts-expect-error
      crypto.randomUUID = undefined;
      const ids = new Set(Array.from({ length: 20 }, () => generateUUID()));
      expect(ids.size).toBe(20);
    } finally {
      crypto.randomUUID = original;
    }
  });
});
