// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateUUID, getPlayerUuid, isEphemeral, _resetForTesting } from "./player-identity";

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

describe("ephemeral detection", () => {
  const STORAGE_KEY = "drawrace-player-uuid";

  beforeEach(() => {
    localStorage.clear();
    _resetForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns non-ephemeral when localStorage works", () => {
    // Default jsdom environment — localStorage is available
    const uuid = getPlayerUuid();
    expect(uuid).toMatch(UUID_V4_RE);
    expect(isEphemeral()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(uuid);
  });

  it("returns ephemeral when localStorage.setItem throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded", "QuotaExceededError");
    });

    const uuid = getPlayerUuid();
    expect(uuid).toMatch(UUID_V4_RE);
    expect(isEphemeral()).toBe(true);
  });

  it("returns same in-memory UUID on repeated calls when ephemeral", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded", "QuotaExceededError");
    });

    const first = getPlayerUuid();
    const second = getPlayerUuid();
    expect(first).toBe(second);
  });

  it("detects ephemeral when localStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Security error");
    });

    const uuid = getPlayerUuid();
    expect(uuid).toMatch(UUID_V4_RE);
    expect(isEphemeral()).toBe(true);
  });
});
