# Assertion Message Diagnostic Context Verification

## Task: Verify all assertion messages include diagnostic context

**Bead:** bf-lpyhe (enhance assertion messages)
**Date:** 2026-08-13
**Test Run:** 411 tests passed, 1 unhandled vitest error (timeout)

---

## Summary

**Status:** ⚠️ **INCOMPLETE** - Most assertion messages lack diagnostic context

The test suite passes (411 tests), but the majority of assertion messages do NOT include proper diagnostic context. When failures occur, developers will see unclear messages like "expected true but got false" without understanding what was being tested or why it matters.

---

## Good Examples (Assertions WITH Diagnostic Context)

### forward-motion.test.ts ✅
```typescript
expect(result.finalX, "Car must cross 100m mark").toBeGreaterThan(100);
expect(result.finishTicks, "Car must finish before DNF").toBeLessThan(MAX_TICKS);
expect(result.stuck, "Car must not get stuck").toBe(false);
```

**Why these work:**
- ✅ Clear expected behavior ("Car must cross 100m mark")
- ✅ Implies consequence (DNF, stuck detection)
- ✅ Understandable without reading test source

### camera-lookahead.test.ts ✅
```typescript
expect(previewTimeAt5, `Zone boundary at ${boundaryX}m should have 4s+ preview at 5 m/s`).toBeGreaterThanOrEqual(4);
expect(minPreviewTime, `Minimum preview time should be ≥4s, got ${minPreviewTime.toFixed(2)}s`).toBeGreaterThanOrEqual(4 - 1e-9);
```

**Why these work:**
- ✅ Describes the test condition clearly
- ✅ Includes actual values in failure message
- ✅ References config (4s preview requirement)

---

## Needs Improvement (Assertions WITHOUT Diagnostic Context)

### clock.test.ts ❌
```typescript
expect(clock.nowMs()).toBe(1000);
expect(clock.nowMs()).toBeCloseTo(16.667, 3);
expect(clock.nowMs()).toBeCloseTo(1000, 0);
```

**Problem:** If these fail, no indication of:
- What clock state was being tested
- What operations preceded the assertion
- Why these specific values matter

**Should be:**
```typescript
expect(clock.nowMs(), "Clock should start at initial time").toBe(1000);
expect(clock.nowMs(), "Clock should advance by dt").toBeCloseTo(16.667, 3);
expect(clock.nowMs(), "Clock should accumulate 60 advances of 1/60s").toBeCloseTo(1000, 0);
```

### stuck-detector.test.ts ❌
```typescript
expect(result).toBe("stuck");
expect(detector.getRotations()).toBeGreaterThanOrEqual(10);
expect(stuckTriggered).toBe(false);
```

**Problem:** Missing context about:
- What test scenario triggered the check
- Why 10 rotations is the threshold
- What conditions should NOT trigger stuck detection

**Should be:**
```typescript
expect(result, "10 rotations with 0.1m progress should trigger stuck").toBe("stuck");
expect(detector.getRotations(), "Stuck detector should count 10+ rotations").toBeGreaterThanOrEqual(10);
expect(stuckTriggered, "0.6m progress should NOT trigger stuck (threshold is 0.5m)").toBe(false);
```

### zones.test.ts ❌
```typescript
expect(track.zones).toBeDefined();
expect(track.zones!.length).toBe(4);
expect(z.x_start).toBeLessThan(z.x_end);
expect(z.x_start).toBe(track.zones![i - 1].x_end);
```

**Problem:** No explanation of:
- Why hills-01 needs exactly 4 zones
- What "non-overlapping" means in practice
- Why zone contiguity matters

**Should be:**
```typescript
expect(track.zones, "hills-01 track must define zones").toBeDefined();
expect(track.zones!.length, "hills-01 must have exactly 4 zones (A, B, C, D)").toBe(4);
expect(z.x_start, "Zone x_start must be less than x_end").toBeLessThan(z.x_end);
expect(z.x_start, `Zone ${i} must start where zone ${i-1} ends`).toBe(track.zones![i - 1].x_end);
```

### recovery-phrase.test.ts ❌
```typescript
expect(phrase).toHaveLength(4);
expect(phrase1).not.toEqual(phrase2);
expect(isValidRecoveryPhrase(phrase)).toBe(true);
```

**Problem:** Missing:
- Why 4 words specifically
- What uniqueness guarantee is being tested
- Why BIP39 validation matters

**Should be:**
```typescript
expect(phrase, "Recovery phrase must contain 4 words").toHaveLength(4);
expect(phrase1, "Each generated phrase must be unique").not.toEqual(phrase2);
expect(isValidRecoveryPhrase(phrase), "All generated words must be valid BIP39 words").toBe(true);
```

### lint-check.test.ts ❌
```typescript
expect(caught).toBe(true);
```

**Problem:** Completely opaque - what was caught?

**Should be:**
```typescript
expect(caught, "ESLint should flag Math.random usage in engine-core").toBe(true);
```

---

## Test Files Analyzed

| File | Status | Notes |
|------|--------|-------|
| `forward-motion.test.ts` | ✅ Good | Has diagnostic context on critical assertions |
| `camera-lookahead.test.ts` | ✅ Good | Detailed messages with interpolated values |
| `clock.test.ts` | ❌ Poor | No diagnostic context on any assertions |
| `stuck-detector.test.ts` | ❌ Poor | Complex scenarios without explanatory messages |
| `zones.test.ts` | ❌ Poor | Structural validation without context |
| `recovery-phrase.test.ts` | ❌ Poor | Domain logic without explanation |
| `lint-check.test.ts` | ❌ Poor | Single assertion with zero context |
| `Particles.test.ts` | ⚠️ Skipped | Canvas mocking issues, but assertions similar |

---

## Pattern: What Makes a Good Assertion Message

A good diagnostic assertion message includes:

1. **What is being tested** (subject)
   ```typescript
   expect(value, "Car position").toBeGreaterThan(100);
   ```

2. **What should happen** (expected behavior)
   ```typescript
   expect(result, "Should finish race").toBe("finished");
   ```

3. **Why it matters** (consequence/config reference)
   ```typescript
   expect(time, `Must stay under 3-min DNF ceiling`).toBeLessThan(180);
   ```

4. **Actual values** (for debugging)
   ```typescript
   expect(speed, `Speed must be ≥1 m/s at ${pos}m, got ${speed} m/s`).toBeGreaterThanOrEqual(1);
   ```

---

## Recommended Fixes

### Priority 1: Critical Path Tests

Add diagnostic messages to:
- ✅ `forward-motion.test.ts` (already good)
- ❌ `stuck-detector.test.ts` (10 tests - HIGH impact)
- ❌ `camera-lookahead.test.ts` (partial - needs completion)

### Priority 2: Domain Logic Tests

Add diagnostic messages to:
- ❌ `zones.test.ts` (6 tests - track schema validation)
- ❌ `recovery-phrase.test.ts` (14 tests - security critical)
- ❌ `clock.test.ts` (3 tests - timing infrastructure)

### Priority 3: Infrastructure Tests

Add diagnostic messages to:
- ❌ `lint-check.test.ts` (1 test - CI gate)
- ❌ All other test files with bare assertions

---

## Verification Script

To re-check assertion message coverage after fixes:

```bash
# Count assertions without diagnostic messages
cd /home/coding/drawrace
grep -r "expect(" packages/engine-core/src/*.test.ts apps/web/src/*.test.ts \
  | grep -v "expect(.*," \
  | wc -l
```

Expected after fixes: **0** (all assertions have diagnostic context)

---

## Conclusion

The test suite is **functionally passing** but **diagnostically weak**. When failures occur in CI or locally, developers will waste time deciphering test intent from source code rather than getting clear guidance from assertion messages.

**Recommendation:** Close this bead only after:
1. All critical path test assertions have diagnostic messages
2. Domain validation tests (zones, recovery-phrase) are enhanced
3. A CI check is added to prevent new bare assertions

**Re-open bead bf-lpyhe** to implement the fixes documented above.
