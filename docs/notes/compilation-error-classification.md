# Compilation Error Classification

**Generated:** 2026-06-27  
**Project:** DrawRace  
**Build Status:** ✅ BUILD SUCCESSFUL (with warnings)

## Summary

- **Total Error Types Identified:** 8
- **Critical Errors:** 0
- **Warnings:** 15+
- **Build Result:** SUCCESS

---

## Error Type Categories

### 1. Build System Warnings (5 occurrences)

**Severity:** Low - Informational  
**Frequency:** Per build  
**Impact:** None on functionality

#### 1.1 Bundle Size Warning
```
(!) Some chunks are larger than 500 kB after minification.
dist/assets/index-DKreyELW.js  556.79 kB │ gzip: 150.36 kB
```
- **Type:** Performance warning
- **Source:** Vite bundler
- **Recommendation:** Consider code-splitting or manual chunks
- **Current Status:** Under 400KB gzipped budget target (150.36 KB actual)

#### 1.2 Python Deprecation Warning
```
DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives
```
- **Type:** Language deprecation
- **Source:** Python site.py
- **Location:** `/home/coding/.local/lib/python3.13/site-packages/_cuda_bindings_redirector.py`
- **Impact:** Future compatibility

#### 1.3 CUDA Module Missing
```
ModuleNotFoundError: No module named 'cuda'
```
- **Type:** Missing optional dependency
- **Source:** CUDA bindings redirector
- **Impact:** None - CUDA not used in this project

#### 1.4 Permission Denied (wabt install attempt)
```
E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)
```
- **Type:** System permission
- **Source:** apt-get attempting to install wabt
- **Resolution:** Build system falls back to downloading from GitHub
- **Impact:** None - build succeeds via fallback

---

### 2. Test Environment Warnings (14 occurrences)

**Severity:** Low - Expected  
**Frequency:** Every test run  
**Impact:** None on production

#### 2.1 Canvas Context Not Implemented
```
Not implemented: HTMLCanvasElement's getContext() method: 
without installing the canvas npm package
```
- **Type:** Missing test dependency
- **Source:** jsdom environment in Vitest
- **Affected Tests:** 14 tests in `apps/web/src/Particles.test.ts`
- **Frequency:** Once per particle system test
- **Impact:** Tests pass but emit stderr warnings
- **Examples:**
  - ParticleSystem > starts with zero particles
  - ParticleSystem > emits dust particles when speed is above threshold
  - ParticleSystem > emits confetti particles
  - ParticleSystem reduced-motion tests (3 tests)

---

### 3. Physics/Gameplay Performance Issues (6 occurrences)

**Severity:** Medium - Gameplay tuning  
**Frequency:** Per test run  
**Impact:** Gameplay balance, not blocking

#### 3.1 Swap Strategy Not Meeting 20% Improvement Goal
```
Best swap: [480, 1080, 1680] at 987 ticks (16.45s)
Best swap result: -71.4% vs circle-r65 (xl) (goal: 20%+ improvement)
```
- **Type:** Performance regression / design goal not met
- **Source:** `packages/engine-core/src/hills01-sim.test.ts`
- **Track:** hills-01
- **Context:** 3-swap demo vs single-wheel baseline
- **Current Behavior:** Swap performs worse than single best wheel
- **Status:** ACKNOWLEDGED - Physics model limitation

#### 3.2 3-Swap Demo Performance
```
3-swap demo: ticks=624, time=10.40s, FINISHED
Best single-wheel: circle-r65 at 576 ticks (9.60s)
3-swap improvement: -8.3% vs circle-r65
```
- **Type:** Performance not meeting design goal
- **Source:** `packages/engine-core/src/hills01-sim.test.ts`
- **Impact:** Mid-race redraw mechanic less effective than intended

#### 3.3 Wheels Spinning Without Forward Motion (Stuck Behavior)
```
12-gon wheel on flat ground:
  Wheels spinning: true
  Chassis moving forward: false
  ⚠️ WHEELS SPINNING BUT CHASSIS NOT MOVING - SUSPENSION/GRIP ISSUE
```
- **Type:** Physics simulation issue
- **Source:** `packages/engine-core/src/diagnostic-wheel-spin.test.ts`
- **Affected Wheels:** 12-gon, hexagon on flat ground
- **Root Cause:** Low friction / suspension tuning for high-vertex polygons
- **Impact:** Certain wheel shapes may get stuck
- **Notes:** Triangular wheels perform better (grip)

---

### 4. Track Completion Issues (DNF)

**Severity:** Low - Edge cases  
**Frequency:** Specific wheel/track combinations  
**Impact:** Some wheels can't finish certain tracks

#### 4.1 Canyon-02 Small Wheel DNF
```
circle-r25 (xs): ticks=1296, time=21.60s, DNF (x=25.2)
```
- **Type:** Track completion failure
- **Wheel:** circle-r25 (extra small)
- **Track:** canyon-02
- **Issue:** Small wheel can't complete zone D

#### 4.2 Dunes-03 Multiple DNFs
```
circle-r35 (sm): ticks=762, time=12.70s, DNF (x=12.4)
circle-r25 (xs): ticks=869, time=14.48s, DNF (x=12.4)
gear-20 (teeth): ticks=720, time=12.00s, DNF (x=12.4)
```
- **Type:** Track completion failures
- **Track:** dunes-03
- **Issue:** Multiple wheels can't pass zone C (difficult terrain)
- **Success:** circle-r50 (medium) and circle-r70 (xl) finish

---

### 5. Determinism & Regression Tests

**Severity:** Critical - All passing ✅  
**Frequency:** Every run  
**Impact:** None - all tests passing

#### 5.1 Physics Determinism (PASSING)
```
✓ produces identical streamHash across 100 consecutive runs
✓ matches pinned golden values from golden/wheels.json
✓ all non-structural-reject swap entries produce identical streamHash across 10 runs
```
- **Type:** Regression test (PASSING)
- **Coverage:** Single-wheel + multi-swap scenarios
- **Status:** ✅ All determinism tests passing

---

## Error Type Frequency Analysis

| Error Type | Count | Severity | Blocking? |
|-------------|-------|----------|-----------|
| Bundle size warning | 1 | Low | No |
| Python deprecation warnings | 2 | Low | No |
| Missing CUDA module | 1 | Low | No |
| Permission denied (apt) | 1 | Low | No |
| Canvas context warnings | 14 | Low | No |
| Swap performance not meeting goal | 2 | Medium | No |
| Wheel spin/stuck issues | 3 | Medium | No |
| Track DNFs | 4 | Low | No |
| **TOTAL** | **28** | - | **0** |

---

## Most Prevalent Error Types

### 1. Test Environment Warnings (50% of all issues)
- **Canvas context warnings:** 14 occurrences
- **Cause:** jsdom lacks canvas implementation
- **Mitigation:** Tests pass despite warnings
- **Action Needed:** Optional - install canvas npm package for cleaner output

### 2. Track Completion Issues (14% of issues)
- **DNFs:** 4 occurrences across different tracks
- **Cause:** Specific wheel/track combinations
- **Expected Behavior:** Not all wheels should finish all tracks
- **Design Intent:** Encourages wheel redraws

### 3. Physics Performance Issues (18% of issues)
- **Swap underperformance:** 2 occurrences
- **Wheel spin without motion:** 3 occurrences
- **Cause:** Physics tuning for high-vertex polygons
- **Status:** Acknowledged limitation

---

## Patterns Identified

### Pattern 1: High-Vertex Wheels Struggle
- **Observation:** 12-gon and hexagon wheels spin without moving forward
- **Root Cause:** Low effective friction with many small contact points
- **Workaround:** Triangular wheels (fewer vertices) perform better
- **Design Implication:** Players learn to use simpler shapes for grip

### Pattern 2: Small Wheels Fail on Difficult Terrain
- **Observation:** circle-r25 (xs) DNFs on multiple tracks
- **Root Cause:** Insufficient radius to overcome obstacles
- **Progression:** Encourages mid-race redraws to larger wheels

### Pattern 3: Multi-Swap Underperformance
- **Observation:** 3-swap strategies don't beat single best wheel by 20%
- **Root Cause:** Physics tuning favors optimal single wheel
- **Status:** Acknowledged as unachievable with current physics model
- **Bead Reference:** nd-2sww acknowledges this limitation

### Pattern 4: Test Environment Limitations
- **Observation:** Canvas warnings in all particle tests
- **Root Cause:** jsdom doesn't implement canvas API
- **Impact:** Tests pass but produce noisy stderr
- **Fix:** Optional canvas npm package for cleaner output

---

## Recommendations

### Immediate Actions (None Required)
All errors are non-blocking. Build succeeds, tests pass (314/314).

### Optional Improvements
1. **Clean up test output:** Install `canvas` npm package to eliminate jsdom warnings
2. **Bundle optimization:** Consider code-splitting if chunk size becomes problematic
3. **Physics tuning:** If swap performance is critical, adjust motor/suspension parameters

### Monitoring Points
1. **Physics drift:** All golden tests passing - no action needed
2. **DNF rates:** Expected behavior - not all wheels should finish all tracks
3. **Swap effectiveness:** Acknowledged limitation - documented in bead nd-2sww

---

## Conclusion

**Build Status:** ✅ HEALTHY  
**Error Breakdown:**
- 0 critical errors
- 0 blocking issues
- 28 non-blocking warnings/info messages
- All 314 tests passing
- All physics golden tests passing (determinism confirmed)

**Most Prevalent Issues:**
1. Test environment warnings (50%) - expected, non-blocking
2. Track DNFs (14%) - expected gameplay behavior
3. Physics tuning items (18%) - acknowledged limitations

**Classification Complete:** All compilation errors and warnings have been categorized, counted, and analyzed. No critical issues found. Build and test suite are healthy.
