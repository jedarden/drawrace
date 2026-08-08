# Track JSON Schema Format

**Purpose:** This document specifies the expected JSON schema format for track configuration files in DrawRace.

**Track file location:** `/apps/web/public/tracks/*.json`

**Current tracks (as of 2026-08-07):**
- `hills-01.json` (numeric_id: 1, "Scribble Slope")
- `canyon-02.json` (numeric_id: 2, "Canyon Run")
- `dunes-03.json` (numeric_id: 3, "Dune Drifter")

## TypeScript Interface

The track schema is defined by the `TrackData` interface in `apps/web/src/App.tsx` and `TrackDef` in `packages/engine-core/src/headless-race.ts`.

```typescript
interface TrackData {
  id: string;
  numeric_id: number;
  world: { gravity: [number, number]; pixelsPerMeter: number };
  terrain: [number, number][];
  obstacles?: Array<{
    type: string;
    pos: [number, number];
    size?: [number, number];
    radius?: number;
    angle?: number;
    friction?: number;
  }>;
  zones?: Array<{ id: string; x_start: number; x_end: number }>;
  ramps?: Array<{ zone: string; x_start: number; x_end: number }>;
  hazards?: Array<{ zone: string; type: string; x_start: number; x_end: number }>;
  surfaces?: unknown;
  start: { pos: [number, number]; facing: number };
  finish: { pos: [number, number]; width: number };
}
```

## Field Specifications

### Required Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | `string` | Human-readable slug for the track (used for filenames) | `"hills-01"` |
| `numeric_id` | `number` | Stable uint16 identifier used on the wire and in database | `1` |
| `world.gravity` | `[number, number]` | X,Y gravity vector (Y-down convention: Y increases downward) | `[0.0, 10.0]` |
| `world.pixelsPerMeter` | `number` | World scale factor | `30` |
| `terrain` | `Array<[number, number]>` | Left-to-right polyline defining road surface (strictly increasing in X) | `[[0, 0.0], [1, 0.15], ...]` |
| `start.pos` | `[number, number]` | Chassis spawn position (must be above terrain Y at that X) | `[1.5, 0.0]` |
| `start.facing` | `number` | Direction multiplier (1 = right, -1 = left) | `1` |
| `finish.pos` | `[number, number]` | Finish line trigger position (X is the trigger point) | `[40.0, 6.4]` |
| `finish.width` | `number` | Width of the finish line trigger zone | `0.2` |

### Optional Fields

| Field | Type | Description | Default Behavior |
|-------|------|-------------|-------------------|
| `obstacles` | `Array<Obstacle>` | Static box/circle obstacles with position, size, friction | No obstacles |
| `zones` | `Array<Zone>` | Named terrain segments for gameplay progression | Throws error if missing/empty |
| `ramps` | `Array<Ramp>` | Special ramp zones for gameplay | No ramps |
| `hazards` | `Array<Hazard>` | DNF trigger regions (e.g., pits) | No hazards |
| `surfaces` | `Array<SurfaceSegment>` | Surface type segments covering terrain X range | Single `"normal"` surface |

## Detailed Field Descriptions

### terrain (Required)

**Format:** Array of `[x, y] coordinate pairs` in meters (world units).

**Constraints:**
- Points must be **strictly increasing in X** (no overhangs in v1 engine)
- Y values are **positive** (road surface sits at positive Y in world space)
- Must have at least 2 points to form a valid edge chain
- Used by Planck.js to build a chain of `Edge` fixtures on a static ground body

**Coordinate System (CRITICAL - Non-negotiable):**
- Planck.js uses **Y-down convention** — Y increases downward
- Gravity is `(0, +10)` by default
- Renderer maps physics `(x, y)` directly to canvas with **no Y-axis flip**
- Chassis/wheels must spawn **above** the road (Y value less than terrain Y)

**Example:**
```json
"terrain": [
  [0, 0.0], [1, 0.15], [2, -0.1], [3, 0.1], [4, -0.15], [5, 0.2], [6, 0.0]
]
```

### surfaces (Optional - Defaults to "normal")

**Format:** Array of surface segments with X ranges and types.

**Surface Types (closed enum):**
| Type | Friction | Restitution | Drag | Visual/Feel |
|------|----------|-------------|------|--------------|
| `normal` | 0.9 | 0.0 | 0 | Baseline tan dirt |
| `ice` | 0.10 | 0.0 | 0 | Wheels spin freely; angular shapes dig in |
| `snow` | 0.45 | 0.0 | 1.5 | Sluggish; wide wheels favored |
| `water` | 0.05 | 0.0 | 3.0 | Heavy drag; compact wheels favored |
| `mud` | 0.70 | 0.0 | 12.0 | Very heavy drag; small wheels essential |
| `rock` | 0.95 | 0.25 | 0 | Grippy but bouncy |

**Validation Rules (enforced by `parseSurfaces()` in `surface.ts`):**
1. Segments must **tile the terrain with no gaps or overlaps**
2. `x_range[0]` must equal previous segment's `x_range[1]` (within 1e-6 tolerance)
3. First segment must start at `terrain[0][0]` (min terrain X)
4. Last segment must end at `terrain[terrain.length-1][0]` (max terrain X)
5. Surface `type` must be one of the 6 valid types above

**Example:**
```json
"surfaces": [
  {"x_range": [0, 8],   "type": "normal"},
  {"x_range": [8, 18],  "type": "ice"},
  {"x_range": [18, 28], "type": "snow"},
  {"x_range": [28, 40], "type": "normal"}
]
```

### zones (Optional - but recommended)

**Format:** Array of zone segments with IDs and X ranges.

**Purpose:** Defines gameplay progression zones for the mid-race redraw mechanic.

**Validation Rules (enforced by `validateZones()` in `surface.ts`):**
1. Zones array is **required and must be non-empty** (throws error if missing/empty)
2. Each zone must have: `id` (string), `x_start` (number), `x_end` (number)
3. `x_start` must be **strictly less than** `x_end`
4. Zones must **tile the terrain with no gaps or overlaps**
5. First zone must start at terrain min X
6. Last zone must end at terrain max X

**Example:**
```json
"zones": [
  {"id": "A", "x_start": 0,  "x_end": 8},
  {"id": "B", "x_start": 8,  "x_end": 18},
  {"id": "C", "x_start": 18, "x_end": 28},
  {"id": "D", "x_start": 28, "x_end": 40}
]
```

### obstacles (Optional)

**Format:** Array of static obstacle objects.

**Supported types:**
- `"box"`: Rectangular obstacle with `size` (width, height)
- `"circle"`: Circular obstacle with `radius`

**Properties:**
- `type`: `"box"` or `"circle"`
- `pos`: `[x, y]` center position in meters
- `size`: `[width, height]` (required for box)
- `radius`: number (required for circle)
- `angle`: rotation angle in radians (optional, defaults to 0)
- `friction`: friction coefficient (optional, defaults to 0.8 for box, 0.6 for circle)

**Example:**
```json
"obstacles": [
  {"type": "box",   "pos": [20.0, 4.4], "size": [0.3, 0.15], "friction": 0.8},
  {"type": "circle", "pos": [25.0, 0.4], "radius": 0.4, "friction": 0.6}
]
```

### ramps (Optional)

**Format:** Array of ramp zones.

**Properties:**
- `zone`: Zone ID string (references zones array)
- `x_start`, `x_end`: X range defining the ramp segment

**Example:**
```json
"ramps": [
  {"zone": "D", "x_start": 36, "x_end": 38}
]
```

### hazards (Optional)

**Format:** Array of hazard regions that trigger DNF.

**Supported types:**
- `"pit"`: Deep pit hazard

**Properties:**
- `type`: `"pit"` (or other hazard type)
- `zone`: Zone ID string
- `x_start`, `x_end`: X range defining the hazard region
- `y`: Y depth of the pit (optional)

**Example:**
```json
"hazards": [
  {"type": "pit", "zone": "D", "x_start": 38, "x_end": 40, "y": 8.0}
]
```

### start (Required)

**Format:** Object with spawn position and facing direction.

**Properties:**
- `pos`: `[x, y]` chassis spawn position in meters
- `facing`: Direction multiplier (1 = right, -1 = left)

**Critical Constraint:**
The chassis spawn Y must be **strictly less than** the terrain Y at `start.pos[0]` by at least the chassis half-height plus wheel radius. On first tick, gravity pulls the chassis down onto the terrain surface.

**Example:**
```json
"start": {"pos": [1.5, 0.0], "facing": 1}
```

### finish (Required)

**Format:** Object with finish line position and width.

**Properties:**
- `pos`: `[x, y]` position where X is the trigger point
- `width`: Width of the finish line trigger zone in meters

**Behavior:**
Crossing `finish.pos[0]` right-to-left does not count (only left-to-right counts).

**Example:**
```json
"finish": {"pos": [40.0, 6.4], "width": 0.2}
```

### world (Required)

**Format:** Object with gravity and scale settings.

**Properties:**
- `gravity`: `[x, y]` gravity vector (Y-down convention)
- `pixelsPerMeter`: Scale factor converting world units to pixels

**Example:**
```json
"world": {
  "gravity": [0.0, 10.0],
  "pixelsPerMeter": 30
}
```

## Complete Example

Here's the complete `hills-01.json` track file:

```json
{
  "id": "hills-01",
  "numeric_id": 1,
  "name": "Scribble Slope",
  "version": 33,
  "world": {
    "gravity": [0.0, 10.0],
    "pixelsPerMeter": 30
  },
  "camera": {
    "followAxis": "x",
    "deadzone": [120, 80],
    "maxZoomOut": 1.0
  },
  "terrain": [
    [0, 0.0], [1, 0.15], [2, -0.1], [3, 0.1], [4, -0.15], [5, 0.2], [6, 0.0], [7, 0.15], [8, 0.0],
    [9, 0.5], [10, 1.2], [11, 1.9], [12, 2.6], [13, 3.3], [14, 4.0], [15, 4.3],
    [16, 4.3], [17, 4.3], [18, 4.3],
    [19, 4.6], [20, 3.9], [21, 4.5], [22, 4.0], [23, 4.4], [24, 4.1], [25, 4.3],
    [26, 4.2], [27, 4.3], [28, 4.3],
    [29, 4.2], [30, 4.1], [31, 4.15], [32, 4.2], [33, 4.3], [34, 4.5],
    [35, 4.8], [36, 5.5], [37, 6.2], [38, 6.4],
    [39, 6.4], [40, 6.4]
  ],
  "zones": [
    {"id": "A", "x_start": 0, "x_end": 8},
    {"id": "B", "x_start": 8, "x_end": 18},
    {"id": "C", "x_start": 18, "x_end": 28},
    {"id": "D", "x_start": 28, "x_end": 40}
  ],
  "obstacles": [
    {"type": "box", "pos": [20.0, 4.4], "size": [0.3, 0.15]},
    {"type": "box", "pos": [22.5, 4.5], "size": [0.3, 0.15]},
    {"type": "box", "pos": [25.0, 4.7], "size": [0.3, 0.15]}
  ],
  "ramps": [
    {"zone": "D", "x_start": 36, "x_end": 38}
  ],
  "hazards": [
    {"type": "pit", "x_start": 38, "x_end": 40, "y": 8.0}
  ],
  "surfaces": [
    {"x_range": [0, 8],   "type": "normal"},
    {"x_range": [8, 18],  "type": "snow"},
    {"x_range": [18, 28], "type": "snow"},
    {"x_range": [28, 34], "type": "water"},
    {"x_range": [34, 40], "type": "normal"}
  ],
  "start": {"pos": [1.5, 0.0], "facing": 1},
  "finish": {"pos": [40.0, 6.4], "width": 0.2},
  "metadata": {
    "targetTimeSeconds": 45,
    "tutorialGhosts": []
  }
}
```

## Validation

Track JSON files are validated at load time by `validateTrackData()` in `apps/web/src/App.tsx`:

```typescript
function validateTrackData(track: TrackData): void {
  const terrainMinX = track.terrain[0][0];
  const terrainMaxX = track.terrain[track.terrain.length - 1][0];

  // Validate surfaces tile coverage (parseSurfaces throws on gaps/overlaps)
  parseSurfaces(track.surfaces, terrainMinX, terrainMaxX);

  // Validate zones tile coverage
  validateZones(track.zones, terrainMinX, terrainMaxX);
}
```

**Validation checks performed:**
1. **Surface coverage:** `parseSurfaces()` in `packages/engine-core/src/surface.ts` validates that surfaces tile the terrain with no gaps or overlaps
2. **Zone coverage:** `validateZones()` in `packages/engine-core/src/surface.ts` validates that zones tile the terrain with no gaps or overlaps
3. **Surface types:** Must be one of `"normal" | "ice" | "snow" | "water" | "mud" | "rock"`
4. **Numeric IDs:** Must be unique across all tracks (enforced at authoring time, not validated at runtime)

## Adding a New Track

1. Create a new JSON file in `/apps/web/public/tracks/` (e.g., `my-track-04.json`)
2. Assign a unique `numeric_id` (e.g., 4)
3. Follow the schema specifications above
4. Add the track to the `TRACKS` array in `apps/web/src/App.tsx` if you want it selectable in the UI
5. Test the track loads and validates correctly

## Related Files

- **Schema definition:** `apps/web/src/App.tsx` (TrackData interface)
- **Engine definition:** `packages/engine-core/src/headless-race.ts` (TrackDef interface)
- **Surface validation:** `packages/engine-core/src/surface.ts`
- **Current tracks:** `apps/web/public/tracks/*.json`
