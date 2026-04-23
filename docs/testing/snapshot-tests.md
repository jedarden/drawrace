# Layer 3: Rendering Snapshot Tests

This document describes the rendering snapshot test infrastructure for DrawRace, as specified in `plan.md` §Testing 4.

## Overview

Layer 3 snapshot tests drive the real renderer with pre-computed physics positions from a replay driver, isolating rendering regressions from physics regressions. Screenshots are captured at deterministic ticks and compared against baseline images with pixelmatch.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Playwright (headless Chromium)                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  snapshot-test.html (minimal fixture page)           │   │
│  │  ├── createRenderer()                               │   │
│  │  └── createReplayDriver(snapshot-fixture.json)      │   │
│  └──────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Renderer.ts (real game renderer)                    │   │
│  │  ├── Terrain, sky, parallax                          │   │
│  │  ├── Wheel, chassis, ghosts                          │   │
│  │  └── Particles, HUD                                  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
            Screenshots at deterministic ticks
                            │
                            ▼
                ┌───────────────────────┐
                │  e2e/snapshots/       │
                │  ├── tick-0.png       │
                │  ├── tick-30.png      │
                │  ├── tick-120.png     │
                │  ├── tick-300.png     │
                │  └── tick-finish.png  │
                └───────────────────────┘
```

## Files

- `e2e/snapshot.spec.ts` - Playwright test suite
- `apps/web/snapshot-test.html` - Minimal fixture page
- `packages/engine-core/src/replay-driver.ts` - Pre-computed frame playback
- `packages/engine-core/fixtures/snapshot-fixture.json` - Pre-recorded race data
- `e2e/snapshots/` - Baseline PNG images
- `.docker/ci-snap/Dockerfile` - Pinned container for consistent rendering
- `docker-compose.snapshot.yml` - Local development runner

## Test Checkpoints

Screenshots are captured at these deterministic ticks:
- **0**: Initial state (before countdown)
- **30**: Early race (~500ms elapsed)
- **120**: Mid race (~2s elapsed)
- **300**: Late race (~5s elapsed)
- **finish**: Final frame (when `isFinished()` is true)

## Running Tests Locally

### Via Docker (recommended for consistent rendering)

```bash
# Generate/update baselines
SNAPSHOT_UPDATE=1 docker compose -f docker-compose.snapshot.yml run --rm snapshot-test

# Verify against baselines
docker compose -f docker-compose.snapshot.yml run --rm snapshot-test
```

### Direct Playwright (host must have required libraries)

```bash
# Install Playwright browsers first
pnpm exec playwright install --with-deps chromium

# Generate/update baselines
SNAPSHOT_UPDATE=1 pnpm test:snapshot

# Verify against baselines
pnpm test:snapshot
```

Note: Direct Playwright requires system libraries (`libnspr4`, `libnss3`, etc.) and may produce different font rendering across hosts. Use Docker for consistency.

## Tolerance Settings

Per plan.md §Testing 4:
- **Threshold**: 0.04 (4% pixel difference tolerance)
- **Max diff area**: 300px (absolute pixel cap)

This generous tolerance accounts for cartoon line jitter while catching structural breakage.

## Pinned Container

The `ghcr.io/drawrace/ci-snap:2026-04-21` image ensures:
- Consistent font rendering (Playwright-bundled fonts only)
- Debian 13 (Bookworm) base OS
- Chromium 121.7 (Playwright pinned version)

To rebuild the image:
```bash
docker build -t ghcr.io/drawrace/ci-snap:2026-04-21 -f .docker/ci-snap/Dockerfile .
```

## Updating Fixtures

To regenerate the snapshot fixture (e.g., after track changes):

```bash
# Regenerate fixture JSON
pnpm regen-snapshot-fixture

# Copy to web public directory
cp packages/engine-core/fixtures/snapshot-fixture.json apps/web/public/fixtures/

# Update baselines
SNAPSHOT_UPDATE=1 docker compose -f docker-compose.snapshot.yml run --rm snapshot-test
```

## Reduced Motion Mode

The renderer respects `prefers-reduced-motion: reduce` to disable confetti and other animations during snapshot testing. This is enforced by the snapshot test fixture.

## CI Integration

Snapshot tests run in the `drawrace-ci` workflow (see `plan.md` §Testing 11):
- **Build step**: `render-snap` runs `pnpm test:snapshot`
- **Container**: Uses `ghcr.io/drawrace/ci-snap:2026-04-21`
- **On failure**: Diff images attached to test report

## Troubleshooting

### "Executable doesn't exist at /root/.cache/ms-playwright..."
Run `pnpm exec playwright install --with-deps chromium` to download browsers.

### "libnspr4.so: cannot open shared object file"
Host is missing required libraries. Use Docker or install:
```bash
sudo apt-get install libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 libxshmfence1
```

### All tests pass but diff images appear
Check that `SNAPSHOT_UPDATE` is not set. The test updates baselines when this env var is truthy or when baseline files don't exist.

### Baseline looks wrong
Delete the baseline file and re-run with `SNAPSHOT_UPDATE=1`:
```bash
rm e2e/snapshots/tick-finish.png
SNAPSHOT_UPDATE=1 docker compose -f docker-compose.snapshot.yml run --rm snapshot-test
```
