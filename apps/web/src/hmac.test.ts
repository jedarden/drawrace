import { describe, it, expect } from "vitest";
import { computeHmac } from "./hmac.js";

describe("hmac (Layer 1)", () => {
  it("returns a hex string", async () => {
    const data = new TextEncoder().encode("test data").buffer;
    const result = await computeHmac(data);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces deterministic output for same input", async () => {
    const data = new TextEncoder().encode("hello world").buffer;
    const a = await computeHmac(data);
    const b = await computeHmac(data);
    expect(a).toBe(b);
  });

  it("produces different output for different inputs", async () => {
    const data1 = new TextEncoder().encode("hello").buffer;
    const data2 = new TextEncoder().encode("world").buffer;
    const a = await computeHmac(data1);
    const b = await computeHmac(data2);
    expect(a).not.toBe(b);
  });

  it("handles empty buffer", async () => {
    const data = new ArrayBuffer(0);
    const result = await computeHmac(data);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});
