import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SW_PATH = join(__dirname, "../public/sw.js");
const SOURCE = readFileSync(SW_PATH, "utf8");

/**
 * Service Worker update-safety contract.
 *
 * Plan §Multiplayer & Backend 14 ("Update strategy") pins the rule:
 *   `skipWaiting: false`. A new SW installs in the background and takes over on
 *   the next navigation, never mid-race.
 *
 * The ONLY mechanisms by which a freshly-installed SW can preempt the running
 * page mid-session are:
 *   - `self.skipWaiting()` called from `install` (or anywhere outside an
 *     explicit client opt-in), and
 *   - `self.clients.claim()` called from `activate` (force every open client
 *     onto the new SW immediately).
 *
 * Their absence is therefore the necessary AND sufficient source-level condition
 * for the behavioral guarantee this suite asserts: **a deployed SW update cannot
 * interrupt an in-flight race.** Asserting the invariant directly on the source
 * is deterministic and regression-proof — unlike a behavioral browser test, it
 * does not depend on synthesising a "new SW version" mid-session, which the dev
 * server cannot serve within a single run (the reason the Playwright
 * service-worker suite can only assert the contract indirectly).
 *
 * Updates may still be activated deliberately — but only when the client opts in
 * by posting `{ type: "SKIP_WAITING" }` after confirming the player is not
 * mid-race.
 */

/** Strip JS comments so explanatory text (e.g. "DELIBERATELY NO skipWaiting()")
 * cannot satisfy or trip the assertions. sw.js contains no `//` inside string or
 * regex literals, so a naive line-comment strip is safe here. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\/\/[^\n]*/g, ""); // line comments
}

/** Find the first body-brace `{` after `addEventListener("eventName",` and return
 * the balanced substring inside it, plus the [start, end) index range. */
function listenerBody(src: string, eventName: string): { body: string; start: number; end: number } {
  const re = new RegExp(`addEventListener\\(\\s*["']${eventName}["']`);
  const m = re.exec(src);
  if (!m) throw new Error(`no addEventListener("${eventName}", ...) found in sw.js`);
  const open = src.indexOf("{", m.index + m[0].length);
  if (open === -1) throw new Error(`no body brace found for "${eventName}" listener`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return { body: src.slice(open + 1, i), start: open + 1, end: i };
    }
  }
  throw new Error(`unbalanced braces in "${eventName}" listener`);
}

const SRC = stripComments(SOURCE);

describe("sw.js update-safety contract (plan §Multiplayer 14: skipWaiting:false)", () => {
  const installBody = listenerBody(SRC, "install").body;
  const activateBody = listenerBody(SRC, "activate").body;
  const messageRange = listenerBody(SRC, "message");

  it("install handler does NOT call skipWaiting() — no mid-race preemption", () => {
    // skipWaiting() in install is exactly the failure mode the plan calls out:
    // a half-loaded bundle replacing the running one while the player draws/races.
    expect(installBody).not.toMatch(/skipWaiting\s*\(/);
  });

  it("activate handler does NOT call clients.claim() — no forced client takeover", () => {
    // claim() would push the new SW onto every open tab immediately, including
    // one mid-race, defeating next-navigation takeover.
    expect(activateBody).not.toMatch(/clients\s*\.\s*claim\s*\(/);
  });

  it("clients.claim() appears nowhere in sw.js", () => {
    const claims = [...SRC.matchAll(/clients\s*\.\s*claim\s*\(/g)];
    expect(claims).toHaveLength(0);
  });

  it("skipWaiting() is reachable ONLY via an explicit SKIP_WAITING client message", () => {
    // Deliberate activation must remain possible (client opts in when safe) but
    // must be gated on the SKIP_WAITING message — never automatic.
    expect(messageRange.body).toMatch(/SKIP_WAITING/);
    expect(messageRange.body).toMatch(/skipWaiting\s*\(/);

    // Every skipWaiting() call site in the file must fall inside the message
    // handler — none may live in install/activate or any other listener.
    const sites = [...SRC.matchAll(/skipWaiting\s*\(/g)];
    expect(sites.length).toBeGreaterThanOrEqual(1);
    for (const site of sites) {
      expect(site.index).toBeGreaterThanOrEqual(messageRange.start);
      expect(site.index).toBeLessThan(messageRange.end);
    }
  });

  it("install and activate handlers are registered (guard against accidental removal)", () => {
    // If the listeners are restructured, the body extraction above would throw —
    // this makes the dependency explicit so a future edit doesn't silently gut
    // the safety surface and leave an evergreen suite.
    expect(installBody.length).toBeGreaterThan(0);
    expect(activateBody.length).toBeGreaterThan(0);
    expect(messageRange.body.length).toBeGreaterThan(0);
  });
});
