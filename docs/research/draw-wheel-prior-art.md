# Draw-Wheel / Draw-Shape Vehicle Games: Prior Art Research

Research conducted April 2026. Covers games where a player draws a shape (wheel, legs, road, vehicle body) that directly affects physics and movement. Focused on mobile and web-based titles relevant to a real-time draw-your-wheel racing game.

---

## 1. Scribble Rider (Voodoo / Tapped Studios, 2020)

**Platform:** iOS, Android, browser (HTML5)  
**Release:** June 30, 2020  
**Downloads:** 20+ million; reached #1 overall in 25 countries  
**Revenue:** Estimated $50K+ monthly at peak

### How the Draw Mechanic Works

A small rectangular drawing pad sits at the **bottom of the screen** at all times during a race. The player uses one finger to trace a shape without lifting — the shape is registered as the wheel the moment the finger is released. The new wheel shape instantly replaces the old one, attached at both axles of the bike/vehicle.

The player can draw absolutely any continuous shape: circles, ovals, squares, triangles, spirals, S-curves, zig-zags, letters written in script, crosses, or meaningless scrawls. The game places no constraint on shape validity. Even a straight line or a squiggle becomes a functional (if poor) wheel.

To draw compound shapes (like an X), the player traces back over parts of the existing stroke rather than lifting the finger.

### When Drawing Happens

**During the race, in real time.** The vehicle moves automatically — the player has no steering or throttle control. The only input is the drawing pad. The vehicle briefly pauses while the player is actively drawing a new shape. This pause is a deliberate tradeoff: you give up race momentum for a potentially better-performing wheel.

This means drawing speed matters. A quickly sketched mediocre circle may outperform a carefully drawn perfect polygon if the pause cost exceeds the performance gain.

### How Shape Affects Physics

Different terrain types reward different wheel geometries:

| Terrain | Optimal Shape | Why |
|---|---|---|
| Flat ground / smooth surface | Near-perfect circle | Smooth rotation, maximum speed |
| Stairs / rocky slopes | Large polygon, S-shape, 5-shape | Angular corners grip steps and pull the vehicle up |
| Smooth vertical walls | Circle still works | Less friction needed |
| Water sections | Straight line / paddle shape | Acts as a paddleboat paddle |
| Mountain cliffs (drone mode) | Short straight line or X | Acts as helicopter rotor blades |
| Sand / loose terrain | Large polygon | More surface contact |

**Key physics observations from player guides:**
- Bigger shapes generally outperform small ones (more rotational leverage)
- Three- and four-sided polygons are broadly effective across terrain types
- Circles fail on rough terrain because they have no angular contact points to grip with
- The vehicle enters a "drone mode" automatically on cliff sections; at this point the wheel acts as a propeller, so circular wheels are useless and a line or X shape is needed

### UX Patterns

- **Drawing pad:** Always visible at the bottom of the screen, a fixed-size rectangular region
- **Instant feedback:** Shape applies immediately on finger lift with no confirmation step
- **Single continuous stroke:** No multi-touch, no eraser, no undo
- **Mid-race redraw:** Players can redraw at any point; the vehicle briefly freezes during drawing
- **Shape persistence:** The current wheel shape carries over until redrawn
- **No shape library or templates:** Everything is freeform

### Visual Style

Hyper-casual aesthetic — clean, flat, bright colors. The vehicle and level geometry are stylized and simple, rendered in 3D. The drawn wheels appear visually on the vehicle as what the player drew (the freeform stroke is visible as the wheel). Reviewers described the visual quality as minimal even by hyper-casual standards — no background music in early versions. Marketing art emphasized the wheel-drawing hook with playful wheel examples (french bread, pencils, tentacles).

### Notable Design Observations

- The mechanic works because **any shape is physically valid**, removing judgment or skill barriers around drawing ability
- The constraint is strategic, not artistic: what shape do I need for this terrain?
- The vehicle auto-moves, so drawing is the entire control surface — the game is about reading ahead and preparing the right wheel shape
- Described by reviewers as "a more upgraded version of Draw Climber"

---

## 2. Draw Climber (Voodoo, 2019–2020)

**Platform:** iOS, Android  
**Developer:** Voodoo  
**Predecessor to Scribble Rider** — the same publisher released Draw Climber roughly a year before Scribble Rider refined the concept.

### How the Draw Mechanic Works

A **small drawing pad at the bottom-center of the screen** lets the player sketch any shape. The drawn shape becomes the **legs** of a square block character. The legs rotate/spin in place on the character's sides, propelling it forward.

Shape examples:
- **Circle:** Acts like a wheel — smooth, fast movement on flat ground
- **Long rectangle:** Adds height/reach, useful for climbing vertical obstacles
- **Z-shape:** Balanced reach and rotation, good for uneven ground
- **Claw/hook shape:** For climbing steep walls
- **Elongated legs:** For crossing wide gaps

The legs spin continuously; their shape determines how the rotation translates to forward movement and obstacle clearance.

### When Drawing Happens

**During the race, mid-run.** The game slows time slightly when the player is drawing, giving a brief window to redesign without being fully penalized by race loss. Players can redraw at any point. The game encourages constant adaptation as the obstacle course changes.

### How Shape Affects Physics

The drawn shape is extruded into a pair of symmetric "legs" attached to both sides of the block. Physics simulates how those leg shapes interact with terrain. A circular leg rotates smoothly; a leg that is too long gets trimmed in tight spaces. The final sprint burst uses accumulated momentum, making the last redraw before the finish line particularly impactful.

### UX Patterns

- Same bottom-of-screen drawing pad as Scribble Rider (this game likely established that convention)
- Continuous single-stroke drawing
- Brief time-slow during drawing (vs. Scribble Rider's full vehicle stop)
- The drawn shape visually appears on the character as the legs

### Visual Style

Minimalist 3D — a simple square block navigates a colorful obstacle course. The legs are rendered from the player's drawn stroke. Very clean and readable.

---

## 3. DrawRace / DrawRace 2: Racing Evolved (RedLynx / Ubisoft, 2009 / 2011)

**Platform:** iOS (iPhone/iPad)  
**Developer:** RedLynx (makers of Trials HD)  
**Release:** DrawRace: 2009; DrawRace 2: September 2011

### How the Draw Mechanic Works

The player draws the **racing line** — the path the car will follow around the track — before the race starts. This is top-down racing where you trace a route through the course geometry. The car then executes that route autonomously.

**Critically, drawing speed maps directly to car speed:** drawing faster through a section makes the car go faster through that section. Drawing slowly through a tight corner makes the car brake appropriately. The player must literally pace their finger around the track at the desired speed profile.

### When Drawing Happens

**Before the race, entirely in a pre-race phase.** The player completes their full route drawing (including multiple laps) before any car moves. There is no mid-race adjustment.

### How Shape Affects Physics

If the player draws too quickly through a sharp corner, the car spins out when executing the line. Physics fidelity punishes unrealistic racing lines. Optimal play requires drawing an "ideal racing line" — cutting apexes correctly, braking before corners, accelerating on exit — just as real racing drivers do.

### UX Patterns

- Full-screen track view with the player tracing on top
- The drawn path appears as a red line on the track before race start
- Ghost car competition (race against recorded lines from other players online)
- Hot-seat multiplayer (multiple players draw lines on same device)
- 30 tracks, 16 cars, 2–4 player multiplayer in DrawRace 2

### Visual Style

Hand-drawn aesthetic characters and artwork. Fast-paced soundtrack. Top-down perspective similar to the 1986 arcade game Super Sprint. Clean and readable.

### Notable Design Observation

DrawRace predates the hyper-casual wave. It treats drawing as **pre-race strategic planning** — a single committed line — rather than dynamic adaptation. The mechanic is sophisticated but demands understanding of real racing concepts.

---

## 4. Crayon Physics Deluxe (Kloonigames, 2009)

**Platform:** PC (2009), iOS (2009), Android (2012, via Humble Bundle)  
**Developer:** Petri Purho / Kloonigames  
**Awards:** Seumas McNally Grand Prize, Independent Games Festival 2008

### How the Draw Mechanic Works

Players draw shapes on the screen that become physical objects. Depending on how the shape is drawn:
- **Closed shapes** become rigid bodies (boxes, triangles, etc.)
- **Circles** can become wheels
- **Lines** can become ropes, hinges, or rigid surfaces
- **Elongated closed shapes** with a joint can form lever mechanisms

The goal is to guide a red ball to touch all stars on each level. The player cannot control the ball directly — all influence comes through drawn objects.

### When Drawing Happens

**During gameplay, at any time.** Players draw, observe physics results, and draw again. There is no race against time in the core mode (though an "elegant solution" scoring system rewards minimalism). Drawing is the primary and continuous interaction.

### How Shape Affects Physics

Drawn objects enter the physics simulation immediately. Circular shapes roll. Rectangular shapes provide surfaces or fall and tip. The game supports pivot points (pins) to create wheels that rotate around a fixed axis — this is how actual wheel mechanisms are constructed within the game.

### UX Patterns

- Full canvas drawing on the level itself (not a separate drawing zone)
- Shapes preserve their drawn appearance (not converted to rectangles — the Deluxe version added this specifically)
- Eraser tool absent by design in early versions (creator's intent: "If you make a mistake, it's there. You can't just erase it.")
- 70 built-in levels plus level editor and hundreds of community levels

### Visual Style

Hand-drawn crayon aesthetic — sketchy lines, paper-texture background. The visual style communicates that physics should feel playful and creative rather than precise.

---

## 5. Line Rider (Boštjan Čadež / "fšk", 2006)

**Platform:** Browser (Flash/JavaScript), later iOS, Android, Nintendo DS, Wii  
**Created:** September 2006 by a Slovenian art student  
**Status:** Internet phenomenon; spawned enormous community of track designers

### How the Draw Mechanic Works

The player draws **lines that form a track** which a boy on a sled ("Bosh") rides after pressing Play. Three line types exist:
- **Normal lines (blue):** Standard track surface
- **Acceleration lines (red):** Add speed to the rider
- **Scenery lines (green):** Decorative only, no physics effect

### When Drawing Happens

**Before playback, in a design phase.** The player builds the entire track, then presses Play to watch Bosh ride. Drawing and riding are distinct phases. Tracks can be as simple as a slope or as complex as multi-minute musical synchronized runs.

### How Shape Affects Physics

Line angle determines gravity's effect on the sled. Steep lines accelerate; level or upward lines decelerate. Loops require sufficient entry speed. The physics must be smooth enough that Bosh doesn't fall off — track continuity is critical. Community creations evolved to include complex jumps, loops, manuals, and precise "flings."

### UX Patterns

- Full-canvas drawing; no separate drawing zone
- No eraser initially (intentional design)
- Play/Stop button to test the track
- The creator deliberately omitted eraser to force commitment to lines

### Visual Style

Minimalist, hand-drawn. Simple white background with thin lines. The rider is a tiny human figure. Background art can be added as scenery. The aesthetic is deliberately sketch-like.

### Cultural Impact

Selected as Jay is Games' Best Webtoy of 2006. Featured in Time Magazine, Yahoo, McDonald's commercials. Spawned countless knock-off games. The community evolved to create precisely engineered tracks synchronized to music (a YouTube genre with tens of millions of views).

---

## 6. Car Drawing Game (various publishers, 2020–2022)

**Platform:** iOS, Android, Browser  
**Multiple implementations:** The "draw one line → car" genre had several independent releases with similar core mechanics.

### How the Draw Mechanic Works

The player draws **one continuous stroke** before the race. The stroke becomes the car body. **The two endpoints of the stroke automatically become wheel positions** — the game attaches wheels at the start and end of the drawn line. This means:
- The shape of the line determines the car body
- Wheel placement is fixed at stroke endpoints
- Players must plan both endpoints and line shape simultaneously

An ink limit constrains how long/complex the stroke can be.

### When Drawing Happens

**Before each level**, in a design phase. Players study the obstacle layout, then draw their car, then the car runs the level.

### How Shape Affects Physics

- Sharp/jagged designs create instability
- Wide, low designs provide better stability
- The center of gravity (determined by shape) affects whether the car tips over
- Certain level geometries (steep hills, gaps) reward specific line shapes

### UX Patterns

- Drawing on a canvas before race start
- Ink meter limits complexity
- Gold medal for first-attempt success; fewer medals for retries
- Speed boost collectibles encourage routing the car through specific points

### Visual Style

2D or 3D depending on implementation. Generally casual/colorful. The car body is the literal drawn stroke, which creates a distinctive "drawn car" look.

---

## 7. Draw Crash Race (Miniclip-style, Web)

**Platform:** Browser (desktop and mobile)  
**Type:** 3D pre-race vehicle design + racing

### How the Draw Mechanic Works

Players **assemble a vehicle before the race** by connecting drawn parts: wheels to the pilot's seat, optional aerodynamic additions. This is less freeform drawing and more connection-of-components through drawing strokes.

### When Drawing Happens

**Before each race**, entirely in the design phase.

### How Shape Affects Physics

The structural integrity of the assembled vehicle matters. Over-complex designs with too many lines become fragile. The vehicle can break apart on impact. Simple, robust designs outperform elaborate ones. Durability upgrades are unlocked through progression.

### UX Patterns

- Component-connection model rather than pure freeform drawing
- Mouse-click interaction for desktop
- Wireframe car aesthetic — the vehicle visually looks like a schematic

### Visual Style

3D with wireframe vehicle aesthetic. Obstacle-filled tracks. Contrasting visual language between the delicate drawn car and the hazardous environment.

---

## 8. Stickman Racer Road Draw (AppQ, iOS/Android)

**Platform:** iOS, Android, PC (Steam)  
**Developer:** Independent

### How the Draw Mechanic Works

The player draws the **road surface** on which the stickman vehicle travels. Drawing happens in real time as the vehicle approaches. A smooth, even road surface keeps the vehicle stable; an uneven or poorly angled road causes crashes.

### When Drawing Happens

**Continuously during gameplay.** As the vehicle advances, the player extends the road ahead of it. The drawing and the movement happen simultaneously, requiring constant attention to both the vehicle state and the upcoming drawing direction.

### How Shape Affects Physics

The angle and smoothness of the drawn road determines vehicle stability. Steep downward angles accelerate; steep upward angles require sufficient momentum. Uneven bumps cause the vehicle to tip and crash. Ragdoll physics apply to the stickman driver on crash.

### UX Patterns

- Drawing happens on the full screen canvas (the road is drawn in the environment, not a separate zone)
- Touch/mouse drag to extend road
- Real-time consequence: drawing error = immediate crash

### Visual Style

2D stickman aesthetic with ragdoll physics. Minimalist. Humorous crash animations.

---

## 9. Doodle Race (Web, 2020s)

**Platform:** Browser (desktop, mobile)

### How the Draw Mechanic Works

Players **design and draw a complete car** before racing, including the vehicle body and wheels. The drawn shape is then converted into a 3D vehicle. The game includes cosmetic customization (colors, stickers) as part of the design phase.

### When Drawing Happens

**Entirely before the race.** A design-then-race structure. The sketch-to-3D-vehicle conversion is the central hook.

### How Shape Affects Physics

The center of gravity determined by the drawn shape affects stability. Tall, thin cars tip over at high speed. Wide, low designs offer better cornering stability. The physics engine "reacts realistically to your drawings."

### UX Patterns

- Two-phase structure: design (drawing), then race
- Mouse drawing on a canvas
- "Paper aesthetic" visual design

### Visual Style

2D drawing phase → 3D racing phase. "Paper aesthetic" — the car retains a doodle-like appearance in the race. Described as charming and casual.

---

## 10. Draw Wheels (RedLineGames, 2023–2024)

**Platform:** Android (June 2024), Browser  
**Developer:** RedLineGames

### How the Draw Mechanic Works

Players **draw wheels during the race** when they need to adapt to obstacles. If the vehicle gets stuck, the player draws new wheels to continue. This is reactive rather than proactive — drawing responds to failure rather than anticipating terrain.

### When Drawing Happens

**Mid-race, on-demand.** No mandatory pre-race drawing phase. Drawing is triggered by getting stuck.

### How Shape Affects Physics

Different terrains require different wheel designs (consistent with the genre: circles for flat, angular shapes for rough). The drawn wheel shape determines traction and clearance.

### UX Patterns

- Reactive drawing (draw when stuck vs. draw in anticipation)
- Available on both browser and Android APK
- Simple, accessible interface

### Visual Style

Described as "simple yet effective," prioritizing accessibility. 3D environment.

---

## 11. Wheel Draw Master (Web, 2023)

**Platform:** Browser (desktop, mobile), portrait orientation  
**Release:** November 21, 2023  
**Engine:** Unity WebGL

### How the Draw Mechanic Works

Players design wheels before navigating a course. The drawn wheel shape directly influences how the bicycle performs on different track sections. Players are encouraged to try different wheel shapes for challenging sections.

### When Drawing Happens

**Before navigation begins for each section.** Design-then-navigate structure.

### How Shape Affects Physics

Different terrains reward different wheel geometries (circles for flat, triangles for grip, horizontal shapes for water). The game has a leaderboard, suggesting optimizing wheel design matters for competitive ranking.

### UX Patterns

- Touch controls for gameplay
- Leaderboard integration
- A noted criticism: once the optimal wheel shape is discovered for each terrain, the challenge disappears

---

## 12. Loco Motion (Josia Roncancio, Ludum Dare 36 game jam, 2016)

**Platform:** HTML5, Windows, macOS, Android  
**Origin:** Game jam entry (Ludum Dare 36)  
**Rating:** 4.5/5 from 73 ratings

### How the Draw Mechanic Works

"Draw wheels on your vehicle and see how fast you can beat the obstacle course." The core mechanic is identical in concept to Scribble Rider, but predates it by four years as a game-jam prototype.

### Notable Details

- Tagged: Physics, Hand-drawn, 2D, 1-bit, High contrast, Textless, One-button
- Accessible design (high contrast mode, one-button playable)
- Short play session: a few minutes
- Demonstrates that the draw-wheel-on-vehicle concept was explored in indie/jam contexts before Voodoo commercialized it

---

## 13. DrawRace (Browser game on Silvergames, 2020s)

**Note:** Distinct from the RedLynx "DrawRace" franchise.

### How the Draw Mechanic Works

Players draw the road surface in real time as the car advances. The drawn line is the road itself — if the line is too uneven, the car stops. The game requires sustained, even strokes to keep the vehicle moving.

### When Drawing Happens

**Continuously in real time during gameplay.** Car movement and road drawing are simultaneous.

### How Shape Affects Physics

Smooth, even lines enable continuous movement. Jagged or steep lines cause the car to fail or slow down. The challenge is analogous to Flappy Bird: maintain a continuous acceptable input to keep the vehicle alive.

---

## 14. Bad Piggies (Rovio, 2012)

**Platform:** iOS, Android, PC  
**Developer:** Rovio Entertainment

**Included for contrast** — not a drawing game, but the closest major-studio precursor to the "build a vehicle from parts" category.

### How the Mechanic Works

Players **assemble vehicles from a parts palette** (wheels, motors, wings, rockets, fans, balloons) on a grid before each level. Drawing is not involved — it is drag-and-drop placement. Physics then simulate the assembled vehicle.

### Relevance

Bad Piggies established the "design then execute" structure and showed that vehicle-building mechanics could be a major commercial hit on mobile. The build-then-run loop is the same as most drawing vehicle games, but the input method is discrete (grid placement) rather than continuous (drawing).

---

## Summary: Common Patterns Across the Genre

### 1. Two Dominant Timing Models

**Pre-race design:** Player draws/designs before the vehicle moves. Examples: DrawRace (RedLynx), Doodle Race, Car Drawing Game, Draw Crash Race. This model rewards planning and deliberate design. Failure causes level restart.

**Real-time / mid-race drawing:** Player draws while the race is happening. Examples: Scribble Rider, Draw Climber, Stickman Racer Road Draw, Draw Wheels. This model rewards reading ahead, adapting quickly, and managing the cost of pausing to redraw.

### 2. What is Being Drawn

| Category | Examples |
|---|---|
| The wheel itself | Scribble Rider, Draw Climber, Wheel Draw Master, Loco Motion |
| The vehicle body | Car Drawing Game, Doodle Race, Draw Crash Race |
| The road / track | Line Rider, DrawRace (browser), Stickman Racer, Road Draw |
| The ideal racing line | DrawRace (RedLynx) |
| Physical objects that influence a ball | Crayon Physics Deluxe |

### 3. Drawing Input Zone

**Separate drawing pad (bottom of screen):** Scribble Rider, Draw Climber. Keeps drawing input visually separate from the race. Player looks at the race while their thumb draws below. This pattern is well-suited to mobile since it doesn't occlude the action.

**Full-screen canvas / on-world drawing:** Line Rider, Crayon Physics Deluxe, Stickman Racer, DrawRace (browser). Drawing happens directly in the game world. More spatially intuitive but occludes the player's view.

**Pre-race off-canvas:** DrawRace (RedLynx), Car Drawing Game, Doodle Race. Drawing and gameplay are separate screens entirely.

### 4. Shape Constraints

**Completely freeform (any continuous stroke):** Scribble Rider, Draw Climber, Line Rider, Crayon Physics Deluxe.

**One-line constraint (single stroke, endpoints become wheels):** Car Drawing Game.

**Component connection:** Draw Crash Race.

**Parts palette:** Bad Piggies (not drawing).

### 5. Shape-to-Physics Translation Approaches

The primary design challenge in this genre is mapping arbitrary drawn strokes to physics behavior:

- **Polygon collider from stroke:** The drawn stroke becomes a rigid body with a collision shape matching the drawn outline. Rotated via wheel joint. (Scribble Rider, Draw Climber approach)
- **Path following:** The drawn line becomes a path the vehicle autonomously follows. Speed determined by drawing speed. (DrawRace RedLynx approach)
- **Road surface:** The drawn line becomes terrain geometry. Vehicle rides on top. (Line Rider, Stickman Racer approach)
- **Rigidbody:** The drawn closed shape becomes a rigid body with calculated mass and friction. (Crayon Physics Deluxe)

### 6. Terrain-Type Driven Design

The most compelling drawing-wheel games use terrain variety to force wheel redesigns. Scribble Rider is the most developed example: flat ground, water, stairs, ice, sand, mountain cliffs, and a special drone/flight mode each require a completely different wheel geometry. This forces continuous player engagement and prevents the game from going on autopilot with a single optimal shape.

---

## What Differentiates the Target Concept

The target game — a mobile web **racing game where players draw wheel shapes in real time and the shape directly affects physics** — sits in the same design space as Scribble Rider and Draw Climber. Key areas of differentiation to consider:

**1. Multiplayer racing:** Scribble Rider has AI opponents only. A real-time multiplayer draw-wheel race where players are competing simultaneously would be a genuine novelty. Each player's drawn wheel is unique, which creates varied gameplay outcomes that are entertaining to watch.

**2. Drawing timing within the race:** Scribble Rider pauses the vehicle during drawing. A system that lets the vehicle continue moving while the player draws (at the cost of divided attention) would raise the skill ceiling and add urgency.

**3. Shape affects more than speed:** Current games map shape primarily to terrain grip and speed. A richer physics model could make shape affect torque, turning radius, stability, jump height, or air resistance — giving players more interesting design tradeoffs.

**4. Visible opponent wheels:** If players can see what shape their opponent has drawn, there is a social/psychological layer (copying the optimal shape, or trying to guess what terrain is coming next based on what the opponent drew).

**5. Progressive terrain with no meta-optimal shape:** The main criticism of Wheel Draw Master (and implicitly, Scribble Rider) is that once players find the optimal wheel for each terrain, the game becomes trivial. A target design should ensure no single shape dominates — either through procedural terrain generation, opponent interference, or physics complexity that creates genuine tradeoffs.

**6. Mobile web (browser-native):** Most competitors are native apps. A browser-based game removes the install barrier, enabling viral sharing and casual play at the cost of requiring mobile-optimized touch drawing input. The drawing zone must be large enough for accurate finger input on small screens.

**7. Drawing fidelity vs. recognizability:** Scribble Rider's approach (any stroke is valid) minimizes frustration but also reduces the cognitive reward of recognizing your shape working. A system that occasionally classifies/identifies the intended shape ("you drew a triangle — good for stairs!") could add a fun layer, but risks frustrating players whose shapes aren't recognized correctly.

---

## Sources Consulted

- Pocket Gamer: [Scribble Rider review](https://www.pocketgamer.com/voodoo/scribble-rider-is-the-best-game-voodoo-have-ever-made/)
- Level Winner: [Scribble Rider guide](https://www.levelwinner.com/scribble-rider-voodoo-guide-tips-cheats-tricks-for-completing-more-levels/)
- ChapterCheats: [Scribble Rider wheel shape guide](https://www.chaptercheats.com/cheat/iphone-ipod/486741/scribble-rider/hint/136923)
- Starloop Studios: [Scribble Rider art marketing case study](https://starloopstudios.com/scribble-rider-game-art-marketing-by-starloop/)
- Pocket Tactics: [Scribble Rider download guide](https://www.pockettactics.com/scribble-rider/download)
- CrazyGames: [Draw Climber](https://www.crazygames.com/game/draw-climber)
- Heardle 90s: [Draw Climber shape guide](https://heardle90s.co.uk/2025/09/01/draw-climber/)
- Wikipedia: [DrawRace](https://en.wikipedia.org/wiki/DrawRace), [DrawRace 2](https://en.wikipedia.org/wiki/DrawRace_2)
- Macworld: [DrawRace review](https://www.macworld.com/article/199724/drawrace.html)
- Wikipedia: [Crayon Physics Deluxe](https://en.wikipedia.org/wiki/Crayon_Physics_Deluxe)
- Jay is Games: [Crayon Physics Deluxe mobile review](https://jayisgames.com/review/crayon-physics-deluxe-mobile.php)
- Wikipedia: [Line Rider](https://en.wikipedia.org/wiki/Line_Rider)
- CrazyGames: [Car Drawing Game 3D](https://www.crazygames.com/game/car-drawing-game-3d)
- Coolmath Games: [Car Drawing Game](https://www.coolmathgames.com/0-car-drawing-game)
- Silvergames: [Road Draw](https://www.silvergames.com/en/road-draw), [Draw Wheels](https://www.silvergames.com/en/draw-wheels)
- Gamaverse: [Draw Wheels](https://gamaverse.com/draw-wheels-game/)
- GamePix: [Wheel Draw Master](https://www.gamepix.com/play/wheel-draw-master)
- Itch.io: [Loco Motion by Josia Roncancio](https://josia-roncancio.itch.io/loco-motion)
- Doodle Road: [doodleroad.com](https://doodleroad.com)
- CrazyGames: [Draw Crash Race](https://www.crazygames.com/game/draw-crash-race)
- Softonic: [Draw Wheels Android](https://draw-wheels.en.softonic.com/android)
- Wikipedia: [Bad Piggies](https://en.wikipedia.org/wiki/Bad_Piggies)
- Steam: [Stickman Racer Road Draw 2](https://store.steampowered.com/app/1004550/Stickman_Racer_Road_Draw_2/)
- Poki: [Doodle Race](https://poki.com/en/g/doodle-race)
- The Casual App Gamer: [Scribble Rider review](https://thecasualappgamer.com/scribble-rider/)
- GameZoo: [Draw Rider](https://gamezoo.net/games/draw-rider/)
