#!/usr/bin/env python3
"""
DrawRace phone-smoke driver — drives a real Pixel 6 via Chrome DevTools Protocol.

Exercises the full game loop: draw -> race -> result, capturing screenshots at
each milestone and failing on any console error or unhandled JS exception.

Usage:
    python3 driver.py [--url URL] [--ws WS_URL] [--artifacts DIR]
                      [--baseline-dir DIR] [--save-baselines]

If --ws is not given, discovers the tab via CDP /json on localhost:9222.
If --url is not given, defaults to http://100.72.170.64:5180/?seed=1
"""

import argparse
import asyncio
import base64
import json
import os
import shutil
import sys
from pathlib import Path

import websockets


# ---------------------------------------------------------------------------
# CDP session — single recv loop so commands and events don't fight
# ---------------------------------------------------------------------------

class CDPSession:
    """WebSocket session with proper command/event message routing."""

    def __init__(self, ws):
        self._ws = ws
        self._id = 0
        self._pending: dict = {}
        self._events: asyncio.Queue = asyncio.Queue()
        self._task = None

    async def start(self):
        self._task = asyncio.create_task(self._recv_loop())

    async def stop(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    async def _recv_loop(self):
        async for raw in self._ws:
            data = json.loads(raw)
            mid = data.get("id")
            if mid is not None and mid in self._pending:
                self._pending[mid].set_result(data)
            elif data.get("method"):
                await self._events.put(data)

    async def call(self, method, params=None, timeout=30):
        self._id += 1
        mid = self._id
        loop = asyncio.get_event_loop()
        fut = loop.create_future()
        self._pending[mid] = fut
        try:
            await self._ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
            data = await asyncio.wait_for(asyncio.shield(fut), timeout=timeout)
        finally:
            self._pending.pop(mid, None)
        if "error" in data:
            raise RuntimeError(f"CDP {method} error: {data['error']}")
        return data

    async def drain_events(self, seconds=1.0):
        """Pull all events that arrive within `seconds` seconds."""
        events = []
        deadline = asyncio.get_event_loop().time() + seconds
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                break
            try:
                evt = await asyncio.wait_for(self._events.get(), timeout=remaining)
                events.append(evt)
            except asyncio.TimeoutError:
                break
        return events

    async def evaluate(self, expr, *, await_promise=True, timeout=30):
        """Evaluate JS in the page; return the result value."""
        resp = await self.call("Runtime.evaluate", {
            "expression": expr,
            "awaitPromise": await_promise,
            "returnByValue": True,
        }, timeout=timeout)
        inner = resp.get("result", {})
        if "exceptionDetails" in inner:
            ex = inner["exceptionDetails"]
            raise RuntimeError(
                f"JS exception: {ex.get('text','')}: "
                f"{ex.get('exception',{}).get('description','')[:400]}"
            )
        rv = inner.get("result", {})
        if rv.get("type") == "undefined":
            return None
        return rv.get("value", rv.get("description", rv))


# ---------------------------------------------------------------------------
# Tab discovery
# ---------------------------------------------------------------------------

async def find_tab(ws_url=None):
    if ws_url:
        return ws_url
    import urllib.request
    tabs = json.loads(urllib.request.urlopen("http://localhost:9222/json", timeout=5).read())
    for tab in tabs:
        u = tab.get("url", "")
        if "5180" in u or "drawrace" in u.lower():
            return tab["webSocketDebuggerUrl"]
    for tab in tabs:
        if tab.get("type") == "page":
            return tab["webSocketDebuggerUrl"]
    return None


# ---------------------------------------------------------------------------
# Error / event collector
# ---------------------------------------------------------------------------

class EventCollector:
    def __init__(self):
        self.errors = []
        self.exceptions = []

    def feed(self, method, params):
        if method == "Runtime.exceptionThrown":
            ex = params.get("exceptionDetails", {})
            text = ex.get("text", "unknown")
            desc = ex.get("exception", {}).get("description", "")[:500]
            self.exceptions.append(f"{text}: {desc}")
        elif method == "Log.entryAdded":
            entry = params.get("entry", {})
            if entry.get("level") == "error":
                self.errors.append(
                    f"[log/{entry.get('source','')}] {entry.get('text','')[:500]}"
                )
        elif method == "Console.messageAdded":
            msg = params.get("message", {})
            if msg.get("level") == "error":
                self.errors.append(f"[console.error] {msg.get('text','')[:500]}")
        elif method == "Runtime.consoleAPICalled":
            if params.get("type") == "error":
                args = [a.get("value") or a.get("description", "") for a in params.get("args", [])]
                self.errors.append(f"[console.error] {' '.join(str(a)[:200] for a in args)}")

    def feed_batch(self, events):
        for evt in events:
            self.feed(evt.get("method", ""), evt.get("params", {}))

    def assert_clean(self):
        if self.exceptions:
            raise RuntimeError(f"Unhandled JS exceptions: {self.exceptions}")
        if self.errors:
            raise RuntimeError(f"console.error / Log.error: {self.errors}")


# ---------------------------------------------------------------------------
# JS snippets
# ---------------------------------------------------------------------------

LANDING_BYPASS_JS = """
(() => {
  localStorage.setItem('drawrace_landing_dismissed', 'true');
  localStorage.setItem('drawrace_invite_access', 'true');
  return true;
})()
"""

DRAW_CIRCLE_JS = """
(async () => {
  const canvas = document.querySelector('canvas[aria-label*="Drawing" i], canvas[role="img"]')
              || document.querySelector('canvas');
  if (!canvas) return {ok: false, err: 'no canvas found'};
  const rect = canvas.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const r  = Math.min(rect.width, rect.height) * 0.35;

  const mk = (type, x, y) => new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true,
    pointerId: 1, pointerType: 'touch', isPrimary: true,
    clientX: x, clientY: y,
    pressure: type === 'pointerup' ? 0 : 0.5,
    width: 30, height: 30,
  });

  const SAMPLES = 80;
  const startX = cx + r * Math.cos(-Math.PI / 2);
  const startY = cy + r * Math.sin(-Math.PI / 2);
  canvas.dispatchEvent(mk('pointerdown', startX, startY));
  await new Promise(r => setTimeout(r, 20));
  for (let i = 1; i <= SAMPLES; i++) {
    const t = -Math.PI / 2 + (i / SAMPLES) * Math.PI * 2;
    canvas.dispatchEvent(mk('pointermove', cx + r * Math.cos(t), cy + r * Math.sin(t)));
    await new Promise(r => setTimeout(r, 8));
  }
  canvas.dispatchEvent(mk('pointerup', startX, startY));
  return {ok: true, cx, cy, r};
})()
"""

CLICK_RACE_JS = """
(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const btn = btns.find(b => /race/i.test(b.textContent));
  if (!btn) return {ok: false, err: 'race button not found',
                    buttons: btns.map(b => b.textContent.trim()).slice(0, 10)};
  if (btn.disabled) return {ok: false, err: 'race button is disabled'};
  btn.click();
  return {ok: true, clicked: btn.textContent.trim()};
})()
"""

WAIT_RESULT_JS = """
(() => new Promise(resolve => {
  const check = () => {
    const main = document.querySelector('[role="main"][aria-label*="result" i]');
    const timer = document.querySelector('[role="timer"]');
    if (main && timer) {
      resolve({ok: true, time: timer.textContent, screen: main.getAttribute('aria-label')});
      return;
    }
    setTimeout(check, 400);
  };
  check();
}))()
"""

CHECK_FINISH_TIME_JS = """
(() => {
  const timer = document.querySelector('[role="timer"]');
  if (!timer) return null;
  const m = timer.textContent.match(/(\\d+):(\\d{2})\\.(\\d{3})/);
  if (!m) return null;
  const ms = parseInt(m[1])*60000 + parseInt(m[2])*1000 + parseInt(m[3]);
  return {text: timer.textContent.trim(), ms};
})()
"""


# ---------------------------------------------------------------------------
# Screenshot + pixel helpers
# ---------------------------------------------------------------------------

async def screenshot(sess, path):
    resp = await sess.call("Page.captureScreenshot", {"format": "png"})
    png_bytes = base64.b64decode(resp["result"]["data"])
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(png_bytes)
    print(f"  Screenshot: {path}")
    return path


def check_not_solid_colour(path):
    """Return (ok, unique_count). Detects 'page crashed to blank' class of bugs.

    A full-phone screenshot of a real game screen always has multiple colours
    (beige background, dark text, canvas, buttons). A blank white/black page
    from a crash has only 1-2 unique colours (1 solid + optional compression
    artifact). We sample 5000 evenly-spaced pixels and check unique count.
    """
    from PIL import Image
    img = Image.open(path).convert("RGB")
    w, h = img.size
    total_px = w * h
    step_px = max(1, total_px // 5000)
    raw = img.tobytes()
    pixels = set()
    for i in range(0, total_px, step_px):
        off = i * 3
        pixels.add((raw[off], raw[off + 1], raw[off + 2]))
    unique_count = len(pixels)
    return unique_count >= 3, unique_count


def compare_baseline(artifact, baseline, threshold=0.12):
    """Compare artifact against baseline using per-pixel diff.

    threshold=0.12 — loose enough for font/antialias variance, tight enough
    to catch an all-transparent canvas (which diffs ~80%+).
    Returns (True/False/None, diff_ratio).  None = no baseline yet.
    """
    if not os.path.exists(baseline):
        return None, 0.0
    from PIL import Image
    a = Image.open(artifact).convert("RGBA")
    b = Image.open(baseline).convert("RGBA")
    if a.size != b.size:
        b = b.resize(a.size, Image.LANCZOS)
    pa, pb = list(a.get_flattened_data()), list(b.get_flattened_data())
    if not pa:
        return False, 1.0
    diffs = sum(1 for x, y in zip(pa, pb) if x != y)
    ratio = diffs / len(pa)
    return ratio < threshold, ratio


# ---------------------------------------------------------------------------
# Main smoke
# ---------------------------------------------------------------------------

async def run_smoke(url, ws_url, artifacts_dir, baseline_dir, save_baselines):
    os.makedirs(artifacts_dir, exist_ok=True)
    os.makedirs(baseline_dir, exist_ok=True)

    tab_ws = await find_tab(ws_url)
    if not tab_ws:
        print("FAIL: No browser tab found. Is Chrome running with --remote-debugging-port?")
        return False
    print(f"Tab: {tab_ws[:80]}...")

    async with websockets.connect(
        tab_ws, max_size=2**24, open_timeout=10,
        ping_interval=None, close_timeout=5,
    ) as ws:
        sess = CDPSession(ws)
        await sess.start()
        collector = EventCollector()

        # Enable CDP domains for event capture
        await sess.call("Runtime.enable")
        await sess.call("Log.enable")
        await sess.call("Console.enable")
        await sess.call("Page.enable")

        # -- STEP 1: Navigate + bypass landing ----------------------------
        # Pre-inject localStorage bypass so the landing/invite gate never
        # appears, even on the very first page load.
        await sess.call("Page.addScriptToEvaluateOnNewDocument", {
            "source": LANDING_BYPASS_JS,
        })
        print(f"Navigating to {url}")
        await sess.call("Page.navigate", {"url": url})
        await asyncio.sleep(3)
        collector.feed_batch(await sess.drain_events(1.0))

        # -- MILESTONE 1: Draw screen ------------------------------------
        canvas_info = await sess.evaluate(
            r"""(() => {
              const c = document.querySelector('canvas');
              if (!c) return {ok: false};
              return {ok: true, w: c.width, h: c.height, aria: c.getAttribute('aria-label')};
            })()""",
            await_promise=False,
        )
        if not canvas_info or not canvas_info.get("ok"):
            print(f"FAIL: Canvas not found: {canvas_info}")
            return False
        print(f"Canvas: {canvas_info['w']}x{canvas_info['h']}  aria={canvas_info.get('aria')}")

        draw_screen = os.path.join(artifacts_dir, "01-draw-screen.png")
        await screenshot(sess, draw_screen)
        ok, count = check_not_solid_colour(draw_screen)
        if not ok:
            print(f"FAIL: Draw-screen is a solid colour (unique={count})")
            return False
        print(f"  Unique colours: {count}")

        # -- STEP 2: Draw circle -----------------------------------------
        print("Drawing circle (80 pointer samples)...")
        draw_result = await sess.evaluate(DRAW_CIRCLE_JS, timeout=30)
        if not draw_result or not draw_result.get("ok"):
            print(f"FAIL: Draw failed: {draw_result}")
            return False
        print(f"  cx={draw_result['cx']:.0f} cy={draw_result['cy']:.0f} r={draw_result['r']:.0f}")
        collector.feed_batch(await sess.drain_events(0.5))

        # -- MILESTONE 2: Draw done --------------------------------------
        after_draw = os.path.join(artifacts_dir, "02-draw-done.png")
        await screenshot(sess, after_draw)
        ok, count = check_not_solid_colour(after_draw)
        if not ok:
            print(f"FAIL: Canvas blank after drawing (unique={count})")
            return False
        print(f"  Unique colours: {count}")

        # -- STEP 3: Click Race ------------------------------------------
        print("Clicking Race...")
        click_result = await sess.evaluate(CLICK_RACE_JS, await_promise=False)
        if not click_result or not click_result.get("ok"):
            print(f"FAIL: Race button: {click_result}")
            return False
        print(f"  Clicked: {click_result['clicked']!r}")
        await asyncio.sleep(1)
        collector.feed_batch(await sess.drain_events(0.5))

        # Early error check — if race init failed, bail fast
        try:
            collector.assert_clean()
        except RuntimeError as exc:
            print(f"FAIL: Error detected after clicking Race: {exc}")
            await screenshot(sess, os.path.join(artifacts_dir, "03-race-init-error.png"))
            return False

        # -- MILESTONE 3: Countdown --------------------------------------
        countdown = os.path.join(artifacts_dir, "03-countdown.png")
        await screenshot(sess, countdown)
        ok, count = check_not_solid_colour(countdown)
        if not ok:
            print(f"FAIL: Countdown screen is a solid colour (unique={count})")
            return False

    # Close the first connection — the race renders at 60fps which can
    # starve Chrome's DevTools socket on mid-range devices (Pixel 6).
    # We reconnect afterwards to check the result screen.
    print("Race running — waiting 15s before reconnecting...")
    await asyncio.sleep(15)

    # -- RECONNECT for result -------------------------------------------
    tab_ws2 = await find_tab()
    if not tab_ws2:
        print("FAIL: No browser tab found after race (Chrome may have closed)")
        return False

    async with websockets.connect(
        tab_ws2, max_size=2**24, open_timeout=10,
        ping_interval=None, close_timeout=5,
    ) as ws2:
        sess2 = CDPSession(ws2)
        await sess2.start()
        post_race_collector = EventCollector()
        await sess2.call("Runtime.enable")
        await sess2.call("Log.enable")

        try:
            # -- MILESTONE 4: Mid-race -----------------------------------
            mid_race = os.path.join(artifacts_dir, "04-mid-race.png")
            await screenshot(sess2, mid_race)
            post_race_collector.feed_batch(await sess2.drain_events(0.5))

            # -- STEP 4: Wait for result screen --------------------------
            print("Waiting for result screen (timeout 90s)...")
            race_result = None
            for attempt in range(45):
                try:
                    race_result = await sess2.evaluate(WAIT_RESULT_JS, timeout=5)
                    break
                except (asyncio.TimeoutError, RuntimeError):
                    pass
                post_race_collector.feed_batch(await sess2.drain_events(0.3))
                try:
                    post_race_collector.assert_clean()
                except RuntimeError as exc:
                    print(f"FAIL: Error during race: {exc}")
                    await screenshot(sess2, os.path.join(artifacts_dir, "04-race-error.png"))
                    return False

            if not race_result or not race_result.get("ok"):
                print("FAIL: Race did not finish within timeout")
                await screenshot(sess2, os.path.join(artifacts_dir, "99-timeout.png"))
                return False

            # -- MILESTONE 5: Result -------------------------------------
            result_screen = os.path.join(artifacts_dir, "05-result.png")
            await screenshot(sess2, result_screen)
            ok, count = check_not_solid_colour(result_screen)
            if not ok:
                print(f"FAIL: Result screen is a solid colour (unique={count})")
                return False

            time_info = await sess2.evaluate(CHECK_FINISH_TIME_JS, await_promise=False)
            if not time_info:
                print("FAIL: Could not read finish time from [role=timer]")
                return False
            print(f"Finish time: {time_info['text']}  ({time_info['ms']}ms)")
            if not (5_000 <= time_info["ms"] <= 120_000):
                print(f"FAIL: Finish time outside expected range 5s-120s: {time_info['text']}")
                return False

            # -- STEP 5: Check no errors fired during the run ------------
            post_race_collector.feed_batch(await sess2.drain_events(2.0))
            try:
                post_race_collector.assert_clean()
            except RuntimeError as exc:
                print(f"FAIL: {exc}")
                return False
            print("Event check OK — no console.error or unhandled exceptions")

        except Exception as exc:
            print(f"FAIL: Unexpected error during result check: {exc}")
            try:
                await screenshot(sess2, os.path.join(artifacts_dir, "99-error.png"))
            except Exception:
                pass
            return False
        finally:
            await sess2.stop()

    # -- Save or compare baselines -------------------------------------------
    milestone_files = sorted(f for f in os.listdir(artifacts_dir) if f.endswith(".png"))
    baseline_failures = []

    for fname in milestone_files:
        artifact = os.path.join(artifacts_dir, fname)
        baseline = os.path.join(baseline_dir, fname)
        if save_baselines:
            shutil.copy2(artifact, baseline)
            print(f"  Baseline saved: {baseline}")
        else:
            ok, diff = compare_baseline(artifact, baseline)
            if ok is None:
                print(f"  {fname}: no baseline (run with --save-baselines first)")
            elif ok:
                print(f"  {fname}: OK  (diff {diff:.1%})")
            else:
                msg = f"  {fname}: BASELINE MISMATCH  diff {diff:.1%} > 12%"
                print(msg)
                baseline_failures.append(msg)

    if baseline_failures:
        print("FAIL: Baseline mismatches (catches 'canvas fully transparent' class of bug):")
        for m in baseline_failures:
            print(f"  {m}")
        return False

    print("\n=== PHONE-SMOKE PASSED ===")
    return True


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="DrawRace phone-smoke CDP driver")
    parser.add_argument(
        "--url", default="http://100.72.170.64:5180/?seed=1",
        help="URL to load in Chrome on the phone",
    )
    parser.add_argument(
        "--ws", default=None,
        help="Direct CDP WebSocket URL (auto-discovered from localhost:9222 if omitted)",
    )
    parser.add_argument(
        "--artifacts", default="e2e/phone-smoke/artifacts",
        help="Directory for screenshots",
    )
    parser.add_argument(
        "--baseline-dir", default="e2e/phone-smoke/baselines",
        help="Directory for baseline images",
    )
    parser.add_argument(
        "--save-baselines", action="store_true",
        help="Write screenshots as new baselines instead of comparing",
    )
    args = parser.parse_args()

    ok = asyncio.run(run_smoke(
        url=args.url,
        ws_url=args.ws,
        artifacts_dir=args.artifacts,
        baseline_dir=args.baseline_dir,
        save_baselines=args.save_baselines,
    ))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
