// This file intentionally uses Math.random to verify the lint rule catches it.
// The test itself verifies the ESLint config is working.
import { describe, it, expect } from "vitest";
import { execSync } from "child_process";

describe("ESLint Math.random ban", () => {
  it("flags Math.random usage in engine-core", () => {
    const code = `
const x = Math.random();
`;
    let caught = false;
    try {
      execSync(
        `npx eslint --stdin --stdin-filename=packages/engine-core/src/test.ts`,
        {
          input: code,
          encoding: "utf-8",
          cwd: "/home/coding/drawrace",
          timeout: 30_000,
        }
      );
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
  });
});
