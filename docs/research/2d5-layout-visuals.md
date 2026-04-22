# 2.5D Side-Scrolling Racing Game: Visual Design & Layout Research

**Context:** A mobile web browser game where players draw wheel shapes that become the vehicle's actual wheels, racing across terrain. Reference styles: Scribble Rider + Hill Climb Racing.

---

## 1. What "2.5D" Means in a Racing Context

"2.5D" is a marketing and design shorthand for a 2D game that uses visual tricks to suggest a third dimension without implementing full 3D geometry. For a side-scrolling racer, this translates to three concrete techniques:

### Camera and Projection
- The camera is fixed to a **strict side-on orthographic view** — no perspective distortion. The vehicle always moves left-to-right across a flat plane (z=0 in world space).
- A **slight upward tilt** (camera looking down 5–10 degrees) is sometimes used to give the ground surface a bit of visible "face," making it feel like a road surface rather than a line. This is subtle and optional.
- FOV for any perspective-assisted camera: 90–110 degrees. Wider (110) shows more of the world and feels faster.
- The camera **leads the vehicle** — it is offset ahead of the car in the direction of travel by roughly 15–25% of screen width. This is a predictive (look-ahead) camera: it constantly interpolates toward the vehicle's projected position a few frames ahead.

### Depth Without 3D
The "2.5D" feel comes entirely from **parallax layer separation** (detailed in Section 6) and **art direction choices** like:
- Slight drop shadows beneath the vehicle to suggest it sits on a surface
- Ground textures with a mild perspective stripe pattern (lighter at top, darker near the car)
- Distant background elements painted slightly bluer/hazier than near elements (atmospheric perspective)
- Vehicle body with an implied side panel face — a thin strip of color below the main silhouette suggests a car chassis viewed from a 15-degree elevated angle

### What NOT to Do
- Avoid actual 3D perspective on the terrain mesh — it destroys the side-scroller readability
- Avoid rotating the camera dynamically; fixed orthographic projection is far more legible on a small mobile screen

---

## 2. Visual Style References and Analysis

### Scribble Rider (Primary Reference)
- **Core aesthetic:** Clean white/off-white drawing canvas with bold black outlines. The "drawn" world sits on a neutral ground.
- **Wheel mechanic visual:** The drawn shape appears on a circular canvas panel, then stamps onto the vehicle axle. The transition (from drawing mode to "locked in" mode) should have a distinct visual moment — a brief ink-solidifying animation.
- **Key insight:** The game keeps the background extremely simple (near-white) so the drawn wheel shape always reads clearly. The player's creation is the visual hero.
- **Color use:** Sparse. A few accent colors for obstacles and terrain markers. The wheel/vehicle is the only complex shape.

### Hill Climb Racing (Terrain Reference)
- **Intentionally naive art:** Protagonist was literally a photograph of a hand-sketch. The game leans into "charming ugly" rather than polished.
- **Terrain mesh:** Procedurally generated via sine/cosine (x,y) point arrays, sampled every 20px. The ground is a filled polygon — a single mesh with a brown/earth-texture fill and a darker outline. No detail above the ground surface except grass/snow texture at the top edge.
- **Vehicle rendering:** Extremely simple boxy shapes. Physics accuracy (wheel torque, suspension springs) is what makes it feel good, not visual fidelity.
- **Color palette:** Biome-based: bright greens for countryside, white+blue for snow, orange+red for moon/alien. Each biome reads immediately from thumbnail size.

### Happy Wheels (Physics + Cartoon Reference)
- **Cartoon style with physics gore:** Flat fills, heavy outlines, no gradients on characters.
- **Originally Flash, ported to JavaScript in 2020.** The sequel uses C++ + OpenGL with normal/specular mapping — but the browser original succeeded on pure 2D with Box2D physics.
- **Key lesson:** Physics *feel* vastly outweighs visual fidelity. Players forgive simple art if the vehicle crunch feels satisfying.

### Art Style Synthesis for This Game
The sweet spot is **"Sketched Casual"**:
- Bold, consistent stroke outlines (2–3px screen-space, scale with device DPR)
- Flat color fills with no gradients on vehicles or terrain (gradients only on sky backgrounds)
- A slightly warm, off-white paper tone as the world ground rather than pure white
- Two or three accent colors max per scene biome — the wheel shape is always the pop of visual interest

---

## 3. Terrain Rendering in 2.5D Side-Scrollers

### How Hill Climb Racing Does It
The terrain is a single continuous polygon generated at startup or in chunks:

1. Generate (x, y) points spaced 20px apart using a combination of sine/cosine offsets layered with noise
2. Create a closed polygon: the point array as the top edge, then a rectangle below it as the fill
3. Physics (Box2D) uses the same point array as a chain collider
4. The OpenGL/Canvas mesh renders the polygon fill as a single draw call — no per-segment calculations at runtime

**For a web browser game, the Canvas 2D equivalent:**
```
ctx.beginPath();
ctx.moveTo(points[0].x, points[0].y);
for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
ctx.lineTo(points[last].x, SCREEN_BOTTOM);
ctx.lineTo(points[0].x, SCREEN_BOTTOM);
ctx.closePath();
ctx.fillStyle = groundFill;
ctx.fill();
ctx.strokeStyle = outlineColor;
ctx.stroke();
```

### Recommended Terrain Stack (Chunked Generation)
- Generate terrain in **chunks of ~400px wide**, roughly 3 chunks ahead of the camera at all times
- Each chunk is a `Path2D` object (if using Canvas 2D) or a pre-built mesh (if WebGL), cached and reused until scrolled off-screen
- Top surface: a 3–4px thick stroke in a darker tone, giving the terrain a "drawn line" quality consistent with the sketch aesthetic
- Sub-surface fill: earthy gradient OR flat color + a subtle horizontal stripe pattern to imply depth
- Surface decoration (grass tufts, rocks, dirt clods): pre-drawn sprites stamped at key x positions during chunk generation, not re-drawn each frame

### Terrain Visual Layers (Cross-Section)
```
[ Skybox / gradient background         ] — static, no parallax
[ Distant hills silhouette             ] — parallax 0.1x speed
[ Mid mountains or trees               ] — parallax 0.3x speed
[ Near ground surface (terrain mesh)   ] — 1.0x speed (moves with camera 1:1)
[ Foreground debris / grass tufts      ] — parallax 1.2x speed (slightly faster)
[ Vehicle + wheels                     ] — rendered on top of terrain
[ UI / HUD                             ] — screen-space fixed
```

---

## 4. Art Style Options and Recommendation

### Option A: Sketch / Hand-Drawn
- **Look:** Thin black outlines, slightly wobbly (add 0.5–1px jitter to stroke paths), paper-textured fill
- **Pros:** Matches the draw-your-wheel mechanic perfectly — the whole game world feels "drawn"
- **Cons:** Wobbly strokes can look cheap if not executed carefully; harder to distinguish terrain types
- **Implementation:** SVG-style paths rendered to canvas; use a slight line wobble filter or pre-drawn wobbly terrain sprites per biome

### Option B: Bold Cartoon (Recommended)
- **Look:** Thick clean outlines (2–3px), vivid flat fills, exaggerated proportions — like a Flash-era web game
- **Pros:** Best legibility on small mobile screens; high contrast; fast rendering (minimal texture memory); easily allows the custom wheel to visually pop
- **Cons:** Less unique — many games look like this
- **Implementation:** Canvas 2D `lineCap: 'round'`, `lineJoin: 'round'` for all shapes; flat color fills; minimal texture maps

### Option C: Minimalist / Geometric
- **Look:** No outlines; shapes defined entirely by color contrast; flat Material-Design-like palette
- **Pros:** Extremely fast to render; modern; good for showcasing the wheel shape (it's the most "designed" element)
- **Cons:** Can feel cold or sterile; terrain reads less well without outlines

### Recommendation: Hybrid (Option A + B)
Use **bold cartoon outlines** on vehicles and wheels, but give the terrain a slightly **imprecise, hand-drawn edge** (2–3px top stroke with mild width variation). The overall palette uses flat fills. This gives the "sketched world" feel without the rendering complexity of true wobbly-line art.

**Palette (per biome):**
- Ground: warm brown `#C8956A`, outline `#6B3A1F`
- Sky: soft gradient from `#87CEEB` (top) to `#E0F4FF` (horizon)
- Vehicle body: neutral mid-gray `#4A4A4A` with a cream `#F5F0E8` window
- Wheel: player-drawn shape — no forced fill color, use a single vivid accent (`#FF6B35` orange default)
- Terrain accent (grass): `#5CB85C` top-edge strip, 4–6px

---

## 5. Rendering Custom / Irregular Wheels

This is the most technically interesting visual challenge. When a player draws a free-form shape that becomes a wheel:

### Physics Approach
Matter.js (or Box2D.js) handles the physics body:
- Player's drawn points → **convex hull decomposition** (since Matter.js requires convex polygons)
- For concave shapes (e.g., a star), decompose into multiple convex sub-bodies using poly-decomp.js
- The physics body rotates around the centroid of the drawn shape
- The angular velocity of the body drives the visual rotation

**Important constraint:** Matter.js vertices must always be convex and in clockwise order. Concave shapes must be decomposed; the library has `Matter.Bodies.fromVertices()` which calls poly-decomp internally if the library is loaded.

### Visual Rendering of the Wheel
The rendered wheel should mirror the player's original drawing exactly — not the convex hull approximation used for physics. Two approaches:

**Approach A: Canvas Path (simplest)**
- Store the player's raw points as a closed Path2D
- Each frame: `ctx.save()`, translate to wheel center, rotate by `body.angle`, draw the path, `ctx.restore()`
- Fill with the player's chosen color, stroke with outline color
- This is a single `fill()` + `stroke()` per wheel per frame — extremely cheap

**Approach B: WebGL Mesh (for effects)**
- Triangulate the drawn shape at draw-time (earcut.js)
- Upload as a static vertex buffer; reuse every frame with only a rotation uniform updated
- Allows fragment shader effects: ink texture overlay, subsurface "paper" glow when the wheel hits terrain

**Recommendation: Approach A for MVP**, upgrade to Approach B if visual polish is needed later.

### Visual Feedback on Irregular Wheels
What makes custom wheels feel good:
- **Rotation trails:** A faint motion blur trail (3–4 semi-transparent copies of the wheel shape at previous rotation angles) shows rotation speed visually — critical for non-circular wheels where rotation is otherwise hard to read
- **Contact flash:** Brief white flash at the exact collision point when the wheel touches terrain (1–2 frame duration)
- **Deformation hint:** Slight squash of the vehicle body on hard landings (scale Y by 0.85 for 3 frames, then spring back via lerp)
- **Ink-splat particles:** Small circular dots that fly off the wheel contact point — reinforce the "drawn" aesthetic

### Centroid and Center of Rotation
The visual center of the wheel (the axle attachment point) should be the **centroid of the drawn polygon**, not the bounding box center. Calculate centroid as:
```
cx = sum(xi) / n
cy = sum(yi) / n
```
This ensures odd shapes (e.g., a crescent) rotate around their physical center of mass.

---

## 6. Parallax Background Techniques for Mobile Web

### Layer Structure (5 layers is the practical maximum for mobile)

| Layer | Content | Scroll Speed | Rendering |
|-------|---------|-------------|-----------|
| Layer 0 | Sky gradient | 0x (static) | CSS background or single canvas fill |
| Layer 1 | Distant mountains / horizon silhouette | 0.1x | Repeating sprite, Canvas |
| Layer 2 | Mid-distance trees / clouds | 0.25x | Sprite loop, Canvas |
| Layer 3 | Near background (bushes, rocks behind terrain) | 0.5x | Sprite loop, Canvas |
| Layer 4 | Terrain mesh + vehicle (game layer) | 1.0x | Main game canvas |
| Layer 5 | Foreground debris | 1.15x | Sparse sprites, same canvas |

### Implementation: Single Canvas, Multiple Offset Calculations
Do not use separate HTML elements or CSS transforms for parallax — this causes layer compositing overhead and repaint issues on mobile. Use a **single Canvas 2D context** and manage offsets in JavaScript:

```javascript
const cameraX = vehicle.x - SCREEN_WIDTH * 0.35; // lead offset

// Each frame:
layers.forEach(layer => {
  const layerOffset = -(cameraX * layer.scrollFactor) % layer.width;
  ctx.drawImage(layer.sprite, layerOffset, layer.y);
  ctx.drawImage(layer.sprite, layerOffset + layer.width, layer.y); // tile
});
```

### Atmospheric Depth Tricks
- **Haze tinting:** Distant layers (0.1–0.25x) tinted with a semi-transparent blue overlay (`rgba(180, 210, 255, 0.15)`) applied at draw-time via globalAlpha or a composite operation
- **Size scaling:** Elements in the 0.25x layer drawn at 60% their normal scale
- **Blur:** Do NOT use CSS `filter: blur()` per-frame on mobile — it triggers GPU rasterization of the entire layer each frame. Pre-blur the sprites offline instead.

### Performance Budget for Mobile Parallax
- 5 layers at 60fps on a mid-range mobile (2022+ Android): achievable with Canvas 2D if sprites are pre-loaded and not scaled at runtime
- Keep each repeating sprite texture under 512px wide (tiles at twice width to cover gaps)
- Use `ImageBitmap` (created via `createImageBitmap()`) instead of raw HTMLImageElement for drawImage calls — significantly faster on Chrome mobile

### Prefers-Reduced-Motion
Always respect `prefers-reduced-motion` media query. When set, disable parallax (all layers scroll at 1.0x speed) and reduce particle effects.

---

## 7. Performance for Smooth 60fps on Mobile Browsers

### Rendering Engine Choice
- **Canvas 2D:** Sufficient for this game type. Achieves 60fps on mid-range mobile when structured correctly. No dependency overhead. Best choice for MVP.
- **PixiJS (WebGL):** Adds 200KB+ but unlocks texture batching (up to 16 textures per draw call), filters, and shaders. Worthwhile if visual effects become important.
- **WebGL raw:** Most control, steepest complexity. Not needed for this game's visual requirements.
- **DOM/CSS animation:** Never use for game rendering. DOM manipulation for 60fps game loops causes layout thrash and frame drops.

### Critical Performance Rules

**1. requestAnimationFrame loop**
Always use `requestAnimationFrame`. Cap at 60fps with a delta-time accumulator so physics remains consistent on 120Hz screens.

**2. Avoid per-frame allocations**
- Pre-allocate all particle objects in a pool; reuse them (set `active = false` when done)
- Do not create new `Path2D` or `new Array()` inside the render loop
- Cache wheel path as a `Path2D` object the moment the player finishes drawing; reuse each frame

**3. Draw call minimization**
- Batch all terrain geometry as a single `fill()` call per chunk
- Use a single sprite atlas for all decoration sprites; one `drawImage` per atlas region

**4. Texture constraints for mobile**
- Max texture/canvas size: 4096×4096px (iPhone 6S era limit; safe target)
- Sprite atlas: pack all game sprites into one 1024×1024 or 2048×2048 atlas
- No runtime texture scaling — pre-size all assets at 1x and 2x for device pixel ratio

**5. Dirty-rect rendering (optional optimization)**
The HUD (speed display, progress bar) rarely changes. Draw it to a separate off-screen canvas; blit it to the main canvas only when it changes, not every frame.

**6. Physics tick decoupling**
Run physics at a fixed 60Hz timestep but allow the renderer to run ahead via interpolation. If the device drops to 30fps rendering, physics remains accurate.

**7. WebGL upgrade path**
If Canvas 2D can't hold 60fps on target devices (test on a 2020-era Android mid-range), switch the rendering layer to PixiJS. The game logic, physics, and parallax math are renderer-agnostic; only the draw calls change.

**8. Bundle and load time**
- Target: under 8 seconds to first interactive on a 4G connection
- Lazy-load biome 2+ assets; only load biome 1 assets on startup
- Use compressed formats: WebP for sprites, WOFF2 for any custom fonts
- Inline critical JS (physics + renderer) in the main bundle; async-load sound

### Frame Budget at 60fps (16.67ms per frame)

| Task | Budget |
|------|--------|
| Physics update (Matter.js) | ~3ms |
| Parallax layer compositing | ~2ms |
| Terrain mesh redraw | ~1ms |
| Vehicle + wheel render | ~1ms |
| Particles + effects | ~2ms |
| HUD update | ~0.5ms |
| Overhead / browser | ~4ms |
| **Margin** | **~3ms** |

---

## 8. UI Layout and HUD Design for Mobile

### Screen Layout (Portrait vs. Landscape)
This game **must be landscape** — side-scrolling racing on a portrait phone gives inadequate look-ahead. Target 16:9 or 18:9 landscape.

### Touch Control Placement
- **Throttle/brake:** Right thumb zone — two large tap areas covering the right 30% of the screen, vertically split (top = throttle, bottom = brake). No visible buttons during drawing phase.
- **Drawing phase:** Full-screen canvas overlay when in wheel-drawing mode. A "lock in" button appears bottom-center once the shape is closed.
- **Avoid:** Any control in the center of the screen — thumbs block the vehicle.

### HUD Elements (Minimal)
- **Speed indicator:** Top-left corner, small — a simple horizontal bar or a number. Not a dial (takes too much space).
- **Terrain progress:** A thin strip along the top edge — shows current position on the level.
- **Wheel shape preview:** Small thumbnail in bottom-left showing the current wheel shape (so player knows which wheel is active if they drew multiple).
- **Fuel / coin count:** Top-right corner, icon + number only.

### Visual Hierarchy Principle
The **vehicle and wheel** must be the most visually prominent element on screen at all times. Achieve this by:
- Ground and background using only muted/desaturated colors
- Vehicle using the highest-saturation colors in the palette
- HUD elements at 60% opacity when not interacted with, 100% opacity on interaction

---

## 9. Recommended Art Direction Summary

### The "Drawn World" Concept
The game world should feel like it was drawn on the same piece of paper as the wheel. Specific direction:

- **Sky:** Soft watercolor-style gradient (blue at top, warm peach at horizon) — rendered as a canvas `createLinearGradient()`, drawn once per scene change
- **Background hills:** Bold silhouette shapes with a slightly rough (pre-drawn) edge, in a single muted sage green or slate blue, no internal detail
- **Terrain surface:** A continuous polygon with a warm tan/brown fill and a hand-drawn-looking dark top edge (pre-rendered sprite stamps for the top lip, not a plain stroke)
- **Vehicle body:** A boxy, cartoonish shape in a neutral color with 2–3px outline. Wheels are the star — the vehicle should be understated.
- **Wheels:** Whatever the player drew, rendered faithfully with their choice of fill color and a bold 2px outline. A faint rotation-motion arc trail shows spin.
- **Particles:** Ink-drop style circles (not pixel sparks) when wheels contact terrain

### Biome Color Progression (Suggested)
| Biome | Ground Fill | Outline | Sky Top | Sky Horizon |
|-------|------------|---------|---------|-------------|
| Countryside | `#C8956A` | `#6B3A1F` | `#87CEEB` | `#E0F4FF` |
| Rocky Hills | `#8B7355` | `#4A3728` | `#B8C4CC` | `#E8EDF0` |
| Snow | `#E8EEF0` | `#7A9BB0` | `#C9DFF0` | `#FFFFFF` |
| Night Desert | `#D4935A` | `#7A4520` | `#1A1A3E` | `#4A3060` |

### Animation Priorities (in order of impact on feel)
1. Wheel contact flash (highest impact, cheapest to implement)
2. Vehicle body squash on landing
3. Rotation trail on the wheel
4. Ink-splat particles at contact points
5. Parallax layer depth (adds environment polish)
6. Terrain edge variation between chunks (prevents sameness)

---

## Sources

- [2.5D - Wikipedia](https://en.wikipedia.org/wiki/2.5D)
- [Optimal Camera Angle For 2.5D Games](https://lensviewing.com/camera-angle-for-2-5d/)
- [Scroll Back: The Definitive Camera Design Guide for 2D Games & Side-Scrollers](https://gamedesignskills.com/game-design/camera-design-2d-side-scroller-games/)
- [Unity 2D Game Perspectives Reference](https://docs.unity3d.com/6000.2/Documentation/Manual/2d-game-perspective-reference.html)
- [Hill Climb Racing - Wikipedia](https://en.wikipedia.org/wiki/Hill_Climb_Racing)
- [How to develop Hill Climb Racing with Cocos2d-x – Terrain](https://jonimikkola.com/how-to-develop-hill-climb-racing-with-cocos2d-x-2/)
- [Hill Climb Racing Terrain Technical Deconstruct](http://www.mikkolajoni.com/2015/03/how-to-develop-hill-climb-racing-with-cocos2d-x-2/)
- [Scribble Rider on Google Play](https://play.google.com/store/apps/details?id=com.tapped.drawrider&hl=en_US)
- [Happy Wheels - Goodboy Digital Case Study](https://www.goodboydigital.com/case-study/happy-wheels)
- [Creating Depth & Immersion: Parallax - GameMaker](https://gamemaker.io/en/blog/creating-depth-and-immersion-parallax)
- [Depth in Motion: The Parallax Effect in Games](https://www.renderhub.com/blog/depth-in-motion-the-parallax-effect-in-games)
- [Game Dev Mechanics: Parallax Scrolling - How It Works](https://moonjump.com/game-dev-mechanics-parallax-scrolling-how-it-works/)
- [Creating a Smooth Horizontal Parallax Gallery: From DOM to WebGL - Codrops](https://tympanus.net/codrops/2026/02/19/creating-a-smooth-horizontal-parallax-gallery-from-dom-to-webgl/)
- [PixiJS Performance Tips](https://pixijs.com/8.x/guides/concepts/performance-tips)
- [Phaser vs PixiJS for making 2D games](https://dev.to/ritza/phaser-vs-pixijs-for-making-2d-games-2j8c)
- [Matter.js Bodies API Docs](https://brm.io/matter-js/docs/classes/Bodies.html)
- [Matter.js Vertices API Docs](https://brm.io/matter-js/docs/classes/Vertices.html)
- [2D Game Art Styles: The Ultimate Guide - 3D-Ace Studio](https://3d-ace.com/blog/2d-game-art-styles-the-ultimate-guide/)
- [Making Art For Hyper-Casual Mobile Games](https://medium.com/playxgames/making-art-for-hyper-casual-mobile-games-6aa40dd856f6)
- [WebGPU vs WebGL in 2026 Browsers](https://cybermaxia.com/en/blog/webgpu-vs-webgl-browser-2026-render-game-konsol)
- [Increase the Performance of Your Games using Canvas](https://gitnation.com/contents/increase-the-performance-of-your-games-using-canvas)
- [Racing Game Design Principles](https://gamedesignskills.com/game-design/racing/)
- [Touch Control Design: Ways Of Playing On Mobile](https://mobilefreetoplay.com/control-mechanics/)
