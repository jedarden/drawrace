# Touch Drawing Input — Research Notes
## Use Case: Player Draws a Wheel Shape → Physics Body for a Racer

---

## 1. Touch Event APIs: Which to Use and Why

### The Two APIs

**Touch Events API** (W3C Level 2) — the original mobile-only API. Fires `touchstart`, `touchmove`, `touchend`, `touchcancel`. Each event carries a `TouchList` of active touch points. This is what iOS Safari has shipped forever.

**Pointer Events API** (W3C Level 3) — a unified hardware-agnostic API that covers mouse, touch, and stylus through one event family: `pointerdown`, `pointermove`, `pointerup`, `pointercancel`. Also exposes `pressure`, `tiltX`, `tiltY`, `twist`, and `width`/`height` of the contact ellipse.

### Current Browser Support (April 2026)

| Browser | Touch Events | Pointer Events |
|---|---|---|
| iOS Safari | Full | Full (added in iOS 13, solid by iOS 15+) |
| Android Chrome | Full | Full |
| Firefox Android | Full | Full |
| Desktop Chrome/Edge | Partial (emulation) | Full |

iOS Safari added Pointer Events in iOS 13 (2019) and has been stable since iOS 15. As of 2026 there is no meaningful install base below iOS 15.

### Recommendation: **Use Pointer Events as primary, with a Touch Events fallback guard**

Reasons:
- Single code path handles mouse (desktop testing), touch (phone), and stylus (iPad).
- `getCoalescedEvents()` is only available on Pointer Events — critical for smooth drawing (see §5).
- `setPointerCapture()` keeps tracking even if the finger slides off the canvas element.
- The W3C Touch Events Community Group explicitly calls Touch Events a legacy API.
- For the drawing-mode canvas, set `touch-action: none` via CSS to hand all touch control to JS and suppress browser scroll/zoom.

```js
canvas.style.touchAction = 'none';
canvas.addEventListener('pointerdown', onDown);
canvas.addEventListener('pointermove', onMove);
canvas.addEventListener('pointerup', onUp);
canvas.addEventListener('pointercancel', onUp);

function onDown(e) {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId); // keeps tracking outside element bounds
  startPath(e.clientX, e.clientY);
}
```

**iOS-specific note:** Even with Pointer Events, iOS Safari will fire passive `touchstart` by default unless you explicitly add `{ passive: false }` to `touchstart` if you need `preventDefault()` there. For a full-screen canvas game with `touch-action: none` set in CSS, this is usually unnecessary — the browser will not scroll anyway.

---

## 2. Canvas-Based Drawing: Capturing Smooth Curves

### Why raw `lineTo` produces jagged strokes

Mobile touch screens sample at 60–120 Hz. At default rAF cadence (60 fps), consecutive `moveTo`/`lineTo` calls between raw sample points produce visible straight-line segments, especially during fast diagonal strokes.

### The midpoint quadratic curve technique

The standard fix: between each pair of consecutive sample points A and B, draw a quadratic Bézier whose control point is A and whose endpoint is the midpoint of AB. This produces a curve that passes through all samples while remaining smooth at joins.

```js
let points = [];

function onMove(e) {
  const pts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const p of pts) {
    points.push({ x: p.clientX, y: p.clientY });
  }
  redraw();
}

function redraw() {
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
  }
  ctx.stroke();
}
```

### Two-canvas architecture

For best performance during an active stroke:
- **Temp canvas** (top, transparent): draw the in-progress stroke here each frame.
- **Committed canvas** (bottom): when `pointerup` fires, blit the completed stroke here, then clear the temp canvas.

This avoids re-rasterising the entire drawing history on every `pointermove`.

---

## 3. Converting a Drawn Path to a Closed Polygon / Physics Body

### Step-by-step pipeline

```
Raw touch points (100s of coords)
        │
        ▼
[Path Simplification]   — remove redundant points, reduce noise
  Simplify.js / RDP     — target: ~30–80 vertices
        │
        ▼
[Close the Path]        — detect near-overlap of start/end, snap closed
        │
        ▼
[Ensure CCW winding]    — most physics engines require counter-clockwise
  poly-decomp.js makeCCW()
        │
        ▼
[Convex Decomposition]  — split concave polygon into convex sub-shapes
  poly-decomp.js / decomp.js
        │
        ▼
[Physics Body Creation] — feed sub-polygons to engine
  Matter.Bodies.fromVertices() or planck.js fixtures
        │
        ▼
[Attach as Wheel]       — connect body to vehicle chassis with RevoluteJoint
```

### Closing the shape

Detect closure by checking whether the last point is within ~20–30px of the first point (in screen coords). When the finger lifts close to the start, snap the path closed and enter racing mode. Show a visual snap indicator (green highlight) so the player knows closure was detected.

### Convex decomposition — why it is required

Box2D, Planck.js, and Matter.js all require **convex** collision shapes. A freehand wheel drawn by a human is almost always slightly concave (dips, lumps). Without decomposition, the engine will silently drop or mis-handle the shape.

**poly-decomp.js** (GitHub: schteppe/poly-decomp.js) is the standard solution:
```js
import { makeCCW, quickDecomp } from 'poly-decomp-es';

const verts = simplifiedPoints.map(p => [p.x, p.y]);
makeCCW(verts);
const pieces = quickDecomp(verts); // array of convex sub-polygons
```

Matter.js will call poly-decomp automatically if you install the package and set `Matter.Common.setDecomp(decomp)` before calling `Matter.Bodies.fromVertices()`.

---

## 4. Library Recommendations

### Drawing / Input

**perfect-freehand** (`steveruizok/perfect-freehand`, npm: `perfect-freehand`)
- Generates pressure-sensitive, variable-width stroke outlines from a point array.
- Simulates pressure on mouse/touch devices that don't report real pressure.
- Returns an SVG-ready outline polygon — you can render it on canvas or SVG.
- Config: `size`, `thinning`, `smoothing`, `streamline`.
- **Best fit for**: making the drawing phase feel premium and pen-like.
- Works on iOS Safari and Android Chrome without polyfills.

```js
import { getStroke } from 'perfect-freehand';
const stroke = getStroke(points, { size: 16, smoothing: 0.5, thinning: 0.5 });
// stroke is an array of [x,y] outline points — draw as a filled path
```

**lazy-brush** (`dulnan/lazy-brush`, npm: `lazy-brush`)
- Adds a spring-damper lag between pointer and brush — smooths out hand tremor.
- Works as a proxy layer: your event handler feeds it raw coords, it returns smoothed coords.
- The `friction` parameter (0–1) controls damping.
- **Best fit for**: reducing jagginess when users draw slowly or with tremor.
- Can be combined with perfect-freehand: lazy-brush smooths input → perfect-freehand renders it.

**signature_pad** (`szimek/signature_pad`, npm: `signature_pad`)
- Mature library for smooth Bézier signature capture on canvas.
- Good reference implementation if you want to roll your own without dependencies.

### Path Simplification

**simplify-js** (`mourner/simplify-js`, npm: `simplify-js`)
- Combines Ramer–Douglas–Peucker (RDP) + radial distance.
- Fast, ~1KB, no dependencies.
- `simplify(points, tolerance, highQuality)` — `tolerance` of 2–5 works well for a wheel shape.

```js
import simplify from 'simplify-js';
const simplified = simplify(rawPoints, 3.0, true); // highQuality = true uses RDP
```

### Convex Decomposition

**poly-decomp-es** (`pmndrs/poly-decomp-es`, npm: `poly-decomp-es`)
- Modern ESM port of poly-decomp.js.
- Exports `makeCCW`, `quickDecomp`, `decomp`.
- Integrates directly with Matter.js.

### Physics Engine

**Matter.js** (`liabru/matter-js`, npm: `matter-js`) — **recommended for this use case**
- `Matter.Bodies.fromVertices()` accepts arbitrary polygon vertex arrays.
- Built-in poly-decomp integration via `Matter.Common.setDecomp(decomp)`.
- `Matter.Constraint` / `Matter.Joint` for attaching the wheel to a chassis body.
- Widely documented, large community, actively maintained.

**Planck.js** (`piqnt/planck.js`, npm: `planck-js`) — **alternative if you need Box2D fidelity**
- True Box2D port — `WheelJoint` and `RevoluteJoint` are first-class.
- Requires manual convex decomposition before feeding vertices.
- Better for complex multi-body vehicle simulations.

### Canvas Rendering

For the drawing phase, **raw Canvas 2D API** is sufficient and fastest. No overhead of Konva/Fabric/Paper.js object models — just `ctx.beginPath()`, quadratic curves, `ctx.stroke()`.

For the racing phase, if you need sprite rendering on top of physics: **Pixi.js** (WebGL, excellent mobile performance) or **Phaser 3** (full game framework with Matter.js and Arcade physics built in).

---

## 5. Latency: Making Drawing Feel Responsive on Mobile

### The frame budget

At 60 Hz you have ~16.7 ms per frame. At 120 Hz (modern iPhones, many Android flagships) you have ~8.3 ms. The physics engine step should run in the same rAF callback to avoid double-buffering lag.

### getCoalescedEvents() — the single most important latency optimization

Browsers coalesce rapid touch events between rAF calls into one `pointermove` event to avoid drowning the JS thread. `getCoalescedEvents()` recovers all intermediate positions:

```js
canvas.addEventListener('pointermove', (e) => {
  const allEvents = e.getCoalescedEvents();
  for (const coalesced of allEvents) {
    recordPoint(coalesced.clientX, coalesced.clientY);
  }
});
```

Without this, fast diagonal strokes lose intermediate points and appear jagged regardless of Bézier smoothing applied afterward. Chrome and Firefox support this. Safari support was added — verify on target iOS version.

### Desynchronized canvas hint

```js
const ctx = canvas.getContext('2d', { desynchronized: true });
```

This allows the browser to update the canvas display without waiting for the compositor, reducing perceived latency by one frame on supported browsers (Chrome 75+, some Android WebViews). The tradeoff is potential tearing; for a drawing canvas (not a game simulation canvas) this is acceptable.

### Avoid DOM layout in the hot path

Do not read `offsetX`/`offsetY` inside the pointer handler — they trigger layout. Use `clientX`/`clientY` and apply a pre-computed transform offset.

### CSS: disable all browser touch behaviors on the game canvas

```css
#game-canvas {
  touch-action: none;       /* disable browser scroll/zoom */
  user-select: none;        /* disable text selection */
  -webkit-user-select: none;
  overscroll-behavior: none;
}
```

### Double buffering during redraw

Keep the `redraw()` function inside a single `requestAnimationFrame` callback — never draw directly from the event handler. Batch all accumulated points from that frame's events, then render once.

```js
let dirty = false;
let pendingPoints = [];

canvas.addEventListener('pointermove', (e) => {
  pendingPoints.push(...e.getCoalescedEvents().map(p => ({ x: p.clientX, y: p.clientY })));
  if (!dirty) {
    dirty = true;
    requestAnimationFrame(render);
  }
});

function render() {
  dirty = false;
  allPoints.push(...pendingPoints);
  pendingPoints = [];
  drawStroke(allPoints);
}
```

---

## 6. Drawing Mode → Racing Mode Transition

### Closure detection

Track the start point of the stroke. When `pointerup` fires, measure distance from the current last point to the start point. If distance < threshold (e.g., 40px scaled to device pixel ratio), treat the path as closed.

```js
function onPointerUp(e) {
  const last = points[points.length - 1];
  const dist = Math.hypot(last.x - points[0].x, last.y - points[0].y);
  if (dist < CLOSURE_THRESHOLD_PX) {
    transitionToRacing();
  }
}
```

### Transition sequence

1. **Visual feedback**: flash the stroke green, animate it shrinking to the wheel position on the vehicle chassis.
2. **Shape processing** (can run off-thread via Worker if vertex count is large):
   - Simplify path with simplify-js
   - Normalize (center + scale — see §7)
   - Decompose with poly-decomp-es
3. **Physics body instantiation**: create the body at the wheel anchor point on the chassis.
4. **Joint attachment**: attach via `RevoluteJoint` (planck.js) or `Matter.Constraint` at the wheel hub center.
5. **Enable motor**: set angular velocity / motor torque to spin the wheel.
6. **Switch input**: swap event listeners from drawing canvas to game input (accelerate, brake).

### Preventing jank during transition

The decomposition step can be expensive for complex shapes. Do it in a `setTimeout(fn, 0)` or a Web Worker, displaying an animated "building wheel..." state while it runs. Target < 100 ms total processing time for a shape with 40–80 vertices.

---

## 7. Shape Normalization

The player draws at an arbitrary position, size, and orientation. The wheel body needs to be centered on its rotation hub, scaled appropriately for the game's physics world scale, and optionally rotated to remove any consistent bias.

### Step 1: Translate to centroid

Compute the polygon's centroid (area-weighted center, not simple average of vertices — the simple average fails for non-uniform vertex density):

```js
function centroid(pts) {
  let ax = 0, ay = 0, area = 0;
  const n = pts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const cross = pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    ax += (pts[j].x + pts[i].x) * cross;
    ay += (pts[j].y + pts[i].y) * cross;
    area += cross;
  }
  area /= 2;
  return { x: ax / (6 * area), y: ay / (6 * area) };
}

const c = centroid(pts);
const centered = pts.map(p => ({ x: p.x - c.x, y: p.y - c.y }));
```

### Step 2: Scale to target radius

Compute the mean distance from centroid to all vertices (equivalent to average "radius"). Scale all vertices so this mean radius matches the target wheel radius in physics world units:

```js
const meanR = centered.reduce((sum, p) => sum + Math.hypot(p.x, p.y), 0) / centered.length;
const scale = TARGET_WHEEL_RADIUS / meanR;
const normalized = centered.map(p => ({ x: p.x * scale, y: p.y * scale }));
```

### Step 3: (Optional) Orient by principal axis

Compute the principal axis of the shape using the covariance matrix of vertex positions, then rotate the shape so the longest axis aligns with a canonical orientation. This prevents a "tilted" wheel due to how the player drew. Usually skip this for a wheel — orientation bias is acceptable and even adds character.

### Step 4: Pixel → physics world units

Convert from screen pixels to physics world units (Matter.js works in pixels by default, so no conversion needed; Planck.js uses meters — use a scale factor, e.g. 1 meter = 30px).

---

## 8. Existing Open-Source Examples and References

### Draw-to-physics pipelines

- **Numpty Physics** (Linux/desktop, C++/Box2D): open-source game where players draw shapes that become physics objects. The original reference implementation for this pattern. Study the closure detection and shape-to-body logic.
  - Source: https://github.com/pettan/numpty-physics

- **poly-decomp.js demo** (browser): https://schteppe.github.io/poly-decomp.js/ — interactive demo showing concave polygon decomposition into convex pieces in real time.

- **p2.js concave demo**: https://schteppe.github.io/p2.js/demos/concave.html — shows `Body.fromPolygon()` with drawn concave shapes.

- **Matter.js fromVertices demo**: https://brm.io/matter-js/demo/ (Compound Bodies demo) — custom shapes created from vertex arrays.

- **perfect-freehand live demo**: https://perfect-freehand-example.vercel.app/ — shows the full drawing feel with simulated pressure.

### Vehicle physics with custom wheels

- **Emanuele Feronato's Phaser + Planck.js tutorials**: https://emanueleferonato.com — dozens of examples including revolute joints and custom polygon bodies. Directly applicable to attaching a user-drawn wheel via a WheelJoint.

- **Box2D Racing Car tutorial** (BinaryTides): https://www.binarytides.com/make-racing-car-box2d-javascript/ — full car-with-wheels setup using Box2D/JS.

### Drawing smoothing

- **Lazy Brush demo**: https://lazybrush.dulnan.net — interactive demo of the lag-behind smoothing technique.

- **Signature Pad** (szimek): https://github.com/szimek/signature_pad — good reference for the two-canvas architecture and Bézier interpolation approach.

- **Exploring Canvas Drawing Techniques** (Perfection Kills): https://perfectionkills.com/exploring-canvas-drawing-techniques/ — deep technical comparison of raw lineTo, quadratic curves, and Catmull-Rom splines.

---

## Data Flow Summary

```
DRAWING PHASE
─────────────
Phone screen (finger)
    │
    ▼ pointerdown / pointermove (with getCoalescedEvents)
    │ touch-action: none, setPointerCapture
    ▼
Raw point array [ {x, y}, ... ]
    │
    ▼ requestAnimationFrame render loop
    │ midpoint quadratic Bézier on temp canvas
    │ perfect-freehand for stroke outline rendering
    ▼
Visual stroke on screen (< 16ms latency)
    │
    ▼ pointerup + closure check (dist < 40px to start)
    │
PROCESSING PHASE (< 100ms, optionally in Worker)
────────────────────────────────────────────────
Simplify path  ←── simplify-js  (tolerance ~3px, RDP)
    │
Normalize      ←── centroid translate → scale to target radius
    │
Ensure CCW     ←── poly-decomp-es makeCCW()
    │
Decompose      ←── poly-decomp-es quickDecomp()  → convex pieces[]
    │
RACING PHASE
────────────
Matter.Bodies.fromVertices(cx, cy, pieces, options)
    │
Matter.Constraint (RevoluteJoint) → attach to chassis body
    │
Motor: body.setAngularVelocity(rpm) or constraint motorSpeed
    │
Matter.Runner.run() + canvas render loop
    │
Game running — player steers / accelerates
```

---

## Library Quick-Reference

| Purpose | Library | Size | Notes |
|---|---|---|---|
| Pressure-sensitive drawing | perfect-freehand | ~4KB | Best visual quality, simulates pressure on touch |
| Stroke lag smoothing | lazy-brush | ~3KB | Optional, combine with above |
| Path simplification | simplify-js | ~1KB | RDP + radial distance, standard choice |
| Convex decomposition | poly-decomp-es | ~8KB | Required for concave shapes in physics engines |
| 2D physics engine | Matter.js | ~87KB | Best DX, built-in poly-decomp integration |
| Alternative physics | Planck.js | ~200KB | True Box2D, better WheelJoint fidelity |
| Polygon utilities | polygon-utils | ~5KB | Centroid, bounding box helpers |

---

## Platform-Specific Gotchas

**iOS Safari:**
- `getCoalescedEvents()` — check iOS version support; has been available since iOS 15.1 but had early bugs. Test on real hardware.
- The 300ms tap delay is eliminated by `touch-action: manipulation` or `none` on the element.
- Avoid `document.body.style.overflow = 'hidden'` as the sole scroll prevention — it does not reliably prevent rubber-band scroll on iOS during touch. Use `touch-action: none` on the canvas element.
- Safari clips canvas elements to viewport — ensure the canvas is positioned with `position: fixed` or inside a `position: fixed` container for full-screen games.

**Android Chrome:**
- `desynchronized: true` canvas context has the best support on Android Chrome — use it for the drawing canvas.
- Chrome implements Pointer Events and `getCoalescedEvents()` fully.
- High-refresh-rate displays (90 Hz, 120 Hz) may expose frame timing bugs if you hard-code 60 fps assumptions — use `performance.now()` based delta time.

**Both:**
- Always test with `devicePixelRatio` — on 3x displays, a 390 CSS pixel canvas is 1170 physical pixels. Set `canvas.width = width * dpr; canvas.height = height * dpr; ctx.scale(dpr, dpr)` and work in CSS pixels.
- The physics engine should run at a **fixed timestep** (e.g., 1/60s) decoupled from rAF — use a fixed-step accumulator pattern to avoid physics instability on high-refresh displays.
