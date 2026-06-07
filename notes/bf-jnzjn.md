# Bug Fix: Car Rolls Backward Past Start Line (bf-jnzjn)

## Summary

This fix adds a static left barrier at `startX - 0.05` to prevent the car from rolling backward behind the starting line.

## Implementation

Both `headless.ts` and `headless-race.ts` now include:

```typescript
// --- left barrier at startX to prevent car from rolling backward past start line ---
const leftBarrier = world.createBody({
  position: Vec2(startX - 0.05, terrainY - 2),
  type: "static",
});
leftBarrier.createFixture(Box(0.05, 10), {
  friction: 0.0,
  restitution: 0.0,
});
```

## Acceptance Tests

Two tests verify the fix in `headless.test.ts`:

1. `left barrier prevents car from rolling backward past startX (bf-jnzjn)` - Tests using `runHeadless` on a flat track
2. `left barrier prevents car from rolling backward past startX in headless-race (bf-jnzjn)` - Manual world setup test

Both tests verify that `chassisX >= startX - 0.15` (with tolerance for chassis width) over 120 ticks on a flat track with no forward terrain.

## Commits

- `f19ab9f` - Added left barrier to both files
- `d00e2df` - Updated golden files and tests after physics change

## Status

✅ Complete - All tests pass
