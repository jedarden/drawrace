# drawrace-vgn.8.15: Stuck-DNF Detection

## Summary

Implemented 10-rotation no-progress detection for flipped/wedged cars.

## Deliverables Completed

1. **packages/engine-core/src/stuck-detector.ts** - StuckDetector class with tick(), reset(), setBaseline()
2. **packages/engine-core/src/headless-race.ts** - Integrated detector; returns stuck state in result
3. **packages/engine-core/src/race-sim.ts** - Integrated detector; resets on wheel swap
4. **apps/web/src/RaceScreen.tsx** - Passes stuck state to onFinished callback
5. **apps/web/src/ResultScreen.tsx** - Shows "Stuck! Try a different wheel shape" message; skips submission
6. **crates/validator/src/resim.rs** - Rust StuckDetector ported with comprehensive unit tests (8 tests)
7. **packages/engine-core/golden/wheels.json** - Added stuck-flipped-triangle and stuck-line-wheel scenarios
8. **packages/engine-core/src/stuck-detector.test.ts** - 8 unit tests covering all spec cases

## Test Results

- TypeScript StuckDetector tests: 8/8 passed
- Rust StuckDetector tests: 8/8 passed
- Golden tests (including stuck scenarios): 16/16 passed

## Retrospective

- **What worked:** The StuckDetector implementation was straightforward - the rotation counter and progress baseline logic maps cleanly to tick-based physics. Using the existing wheel swap reset path made the rescue mechanism simple.
- **What didn't:** Initial test setup for the flipped-triangle golden required trial-and-error to find a shape that actually triggers stuck within a reasonable time.
- **Surprise:** The line-wheel shape (near-degenerate polygon) was discovered during testing - it spins in place beautifully and provides a second stuck scenario without needing obstacle fixtures.
- **Reusable pattern:** For future tick-countered detectors, use the same pattern: accumulator + baseline + reset hook, with deterministic dt-based increment.
