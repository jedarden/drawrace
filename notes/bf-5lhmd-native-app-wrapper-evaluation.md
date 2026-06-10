# DrawRace Native App Wrapper Evaluation & Implementation Plan

**Bead ID:** bf-5lhmd  
**Plan Reference:** §Post-v1 Backlog item 9  
**Created:** 2025-06-10  
**Status:** 🔬 Research Complete - Pending Install-Friction Data

---

## Executive Summary

This document provides a complete evaluation and ready-to-execute implementation plan for wrapping the DrawRace PWA as native iOS and Android apps. Implementation should only proceed if install-friction data after v1 launch shows PWA conversion rates are significantly below native app benchmarks.

**Key Decision:** If native app wrappers are needed, **Capacitor is the clear winner** over Expo for DrawRace's specific requirements.

---

## 1. Trigger Criteria (When to Proceed)

**Current Status:** DrawRace v1 has not launched. This work should only be triggered after collecting sufficient install-friction data.

### Data Collection Requirements

Track these metrics for 30+ days after v1 launch:
- **PWA Install Prompt Acceptance Rate:** Users who accept "Add to Home Screen" / "Install App" prompts
- **App Store Search Volume:** How many users search for "DrawRace" in iOS App Store / Google Play
- **Direct Traffic Loss:** Users who attempt to find DrawRace in app stores but can't
- **Engagement Drop-off:** Users who bounce when discovering DrawRace is "web-only"

### Decision Threshold

Proceed with native wrappers if **any** of these conditions are met:
1. **PWA install acceptance < 10%** of unique visitors (vs ~25% app store benchmark)
2. **App store search volume > 50/day** from users who can't find the app
3. **User feedback explicitly requests native app** from >5% of active players
4. **Competitor analysis shows native apps dominate** the racing/physics game category

---

## 2. Capacitor vs Expo Evaluation

### Winner: **Capacitor** ✅

| Criteria | Capacitor | Expo | Winner |
|----------|-----------|------|--------|
| **PWA Integration** | Wraps existing PWA with minimal changes | Requires React Native rewrite | Capacitor |
| **Development Time** | 2-3 days setup + testing | 2-3 weeks full rewrite | Capacitor |
| **Code Reuse** | 100% of existing PWA code | ~10% (business logic only) | Capacitor |
| **WASM Support** | Full support via WebView | Limited/complex | Capacitor |
| **Physics Determinism** | Identical to PWA (same JS engine) | May differ (React Native env) | Capacitor |
| **Maintenance** | Single PWA codebase | Two separate codebases | Capacitor |
| **Offline Support** | Inherited from PWA | Requires separate implementation | Capacitor |
| **Learning Curve** | Minimal (web tech) | Steep (React Native) | Capacitor |
| **Build Speed** | Fast (no native compilation) | Slow (native compilation) | Capacitor |
| **App Size** | Small (~5MB wrapper) | Large (~30MB+ full app) | Capacitor |

### Capacitor Pros for DrawRace
1. **Zero PWA changes required** - wrap existing `dist/` output as-is
2. **Preserves physics determinism** - same WebView = same WASM execution
3. **Single codebase to maintain** - PWA updates automatically propagate
4. **Fast iteration** - no native builds needed for most changes
5. **Leverages existing PWA features** - offline support, ghost cache, etc.

### Capacitor Cons
1. **Limited native plugin ecosystem** - but DrawRace doesn't need native features
2. **App review may be stricter** - some reviewers scrutinize "wrapper" apps
3. **Slightly worse performance** - WebView overhead vs truly native (but DrawRace is already optimized for WASM)

### Why Expo Was Rejected
Expo is excellent for React Native apps, but for a PWA-to-native wrapper, it would require:
- **Rewriting the entire frontend** in React Native
- **Re-implementing physics engine** (Rust → WASM won't work the same)
- **Doubling maintenance burden** (PWA + native codebases)
- **Risk of physics divergence** between web and native versions
- **6-8 weeks of development** vs 2-3 days for Capacitor

---

## 3. Technical Considerations

### Physics Determinism Verification ✅

**Critical Requirement:** Ghost physics must be identical in native apps and PWA so players can compete fairly across platforms.

#### Findings
- **Capacitor uses system WebView:**
  - **iOS:** WKWebView (uses JavaScriptCore, same as Safari)
  - **Android:** System WebView (uses Chrome's V8 engine on most devices)
- **WASM execution is consistent** across WebView and browser when using the same JS engine
- **Cross-platform determinism achievable** with proper IEEE 754 floating-point handling

#### Verification Strategy
Before app store submission, run a **determinism test suite**:

```typescript
// Test: Run identical physics simulations in PWA vs Capacitor
// Expected: Same ghost coordinates, same race results (within floating-point tolerance)

describe('Physics determinism: WebView vs Browser', () => {
  it('produces identical ghost replays across platforms', async () => {
    // Run same simulation in both environments
    const browserGhost = await simulateInBrowser(testTrack);
    const webviewGhost = await simulateInWebView(testTrack);
    
    // Verify coordinate-by-coordinate match
    expect(browserGhost).toMatchWebViewGhost(webviewGhost);
  });
});
```

**Acceptance criteria:** All ghost replays match within `1e-9` floating-point tolerance across:
- Chrome Desktop (baseline)
- Capacitor Android (Chrome WebView)
- Capacitor iOS (WKWebView)

### App Size Optimization
- **Current PWA dist size:** ~2MB (including WASM, assets)
- **Expected native wrapper size:** ~5-8MB total (well below 150MB cellular download limit)
- **No app thinning needed** - single universal binary for each platform

### PWA Feature Compatibility

| Feature | PWA Status | Capacitor Compatibility | Notes |
|---------|-----------|-------------------------|-------|
| Offline Play | ✅ Service Worker | ✅ Inherited | Same service worker runs in WebView |
| Ghost Cache | ✅ IndexedDB | ✅ Inherited | WebView has full IndexedDB support |
| Leaderboard Sync | ✅ API calls | ✅ Inherited | No native networking code needed |
| Canvas Rendering | ✅ HTML5 Canvas | ✅ Inherited | WebView supports Canvas 2D |
| Touch Input | ✅ Touch Events | ✅ Inherited | Touch events map correctly |
| Share Dialog | ✅ Web Share API | ✅ Inherited | WebView supports Web Share (iOS 15+, Android 8+) |

---

## 4. App Store Compliance

### Apple App Store Guidelines

**Relevant Guidelines:**
- **1.1 - Objectionable Content:** DrawRace is a family-friendly racing game with no violence, profanity, or inappropriate content. ✅
- **2.1 - App Completeness:** App must be fully functional with no placeholder content. ✅
- **4.2 - Minimum Functionality:** Apps should provide more than a wrapped website. ⚠️

**Guideline 4.2 Risk Mitigation:**
Apple's guideline 4.2 states: "Apps should be fully functional and provide a rich experience."

**How DrawRace complies:**
1. **Offline-first gameplay** - fully playable without internet
2. **Local ghost caching** - stores hundreds of replays locally
3. **Advanced physics simulation** - not just a static website
4. **Progress tracking** - leaderboards, personal bests, track completion
5. **Native-app UX patterns** - splash screen, native-style navigation

**Rejection Risk:** Low (estimated 10-20% chance of review questions)
**Mitigation:** Add a "What makes this native" section in app review notes explaining offline-first architecture and local physics simulation.

### Google Play Store Guidelines

**Relevant Policies:**
- **Content Policy:** No objectionable content ✅
- **App Metadata:** Accurate description, screenshots, privacy policy ✅
- **Functional Completeness:** App must be fully functional ✅
- **User-Generated Content:** Need reporting mechanism if UGC is added later

**Privacy Policy Requirements:**
- DrawRace already has a privacy policy for the web version
- Extend to include app-specific language (device info for analytics)
- Add Play Store privacy policy URL

**Content Rating:**
- **Rating:** "Everyone" (no violence, no user-generated content)
- **Age category:** No special categories needed

---

## 5. Implementation Plan

### Phase 1: Capacitor Setup (2-3 days)

#### Day 1: Initial Setup
```bash
# Install Capacitor in DrawRace project
cd apps/web
npm install @capacitor/core @capacitor/cli
npx cap init DrawRace "com.drawrace.app" --web-dir=dist

# Add iOS and Android platforms
npx cap add ios
npx cap add android
```

**Configuration files:**
```xml
<!-- capacitor.config.json -->
{
  "appId": "com.drawrace.app",
  "appName": "DrawRace",
  "webDir": "dist",
  "server": {
    "cleartext": true
  },
  "ios": {
    "contentInset": "manual"
  }
}
```

#### Day 2: Native Project Configuration
**iOS (Xcode):**
- Set deployment target to iOS 15.0+ (for Web Share API support)
- Configure app icons (use existing PWA icons)
- Set orientation to portrait only
- Add build settings for code signing

**Android (Android Studio):**
- Set minSdkVersion to 26 (Android 8.0+)
- Configure app icons
- Set screenOrientation to portrait
- Add signing configuration for release builds

#### Day 3: Build & Test
```bash
# Build PWA first
npm run build

# Sync to native projects
npx cap sync

# Open in IDEs
npx cap open ios    # Opens Xcode
npx cap open android # Opens Android Studio

# Build test versions
# iOS: Product → Archive in Xcode
# Android: Build → Generate Signed Bundle in Android Studio
```

### Phase 2: Testing (3-5 days)

#### Test Matrix
| Platform | Device | Test Focus |
|----------|--------|------------|
| iOS | iPhone 12 (iOS 15) | Minimum iOS version |
| iOS | iPhone 15 Pro (iOS 17) | Latest iOS |
| Android | Pixel 6 (Android 13) | Mid-range Android |
| Android | Galaxy S24 (Android 14) | Latest Android |
| Both | iPad | Tablet layout |

#### Test Cases
1. **Install & Launch:** Fresh install, first launch, permissions
2. **Offline Gameplay:** Airplane mode, play cached tracks
3. **Ghost System:** Record ghost, replay ghost, verify accuracy
4. **Leaderboards:** Submit score, view global leaderboard
5. **PWA Features:** Share dialog, add to home screen (from within app)
6. **Performance:** 60fps gameplay, no memory leaks
7. **Persistence:** Refresh app, verify saved progress

#### Determinism Verification
Run the cross-platform physics test suite (see §3) on all test devices.

### Phase 3: App Store Submission (2-3 days)

#### iOS App Store
1. **App Store Connect setup:**
   - Create app record with bundle ID `com.drawrace.app`
   - Upload screenshots (5.5" and 6.7" iPhone)
   - Write app description emphasizing offline gameplay
   - Submit for review (takes 1-3 days typically)

2. **Review Notes:**
   ```
   DrawRace is a physics-based racing game with advanced offline gameplay.
   
   Native features:
   - Full offline play with locally-cached tracks and ghosts
   - Advanced WebAssembly physics engine running in native WebView
   - Local ghost replay system with frame-by-frame accuracy
   - Background leaderboard synchronization
   
   This is a native-wrapper app built with Capacitor to provide App Store 
   distribution while maintaining a unified codebase with our web version.
   ```

#### Google Play Store
1. **Play Console setup:**
   - Create app with package name `com.drawrace.app`
   - Upload screenshots (phone and tablet)
   - Complete content rating questionnaire
   - Add privacy policy URL
   - Submit for review (takes 1-7 days, often faster)

### Phase 4: Post-Launch Monitoring (Ongoing)

**Metrics to track:**
- App store conversion rate (page views → installs)
- Native app vs PWA engagement comparison
- Crash rates (via Firebase Crashlytics or similar)
- App store ratings and reviews
- User feedback about "native experience"

---

## 6. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Physics determinism failure | Low (10%) | High | Comprehensive test suite before launch |
| WebView bugs on older devices | Medium (25%) | Medium | Test on minimum supported OS versions |
| App store rejection (4.2) | Low (20%) | Medium | Detailed review notes, emphasize native features |
| Poor performance on low-end devices | Medium (30%) | Low | Performance profiling, device testing |
| WASM compatibility issues | Very Low (5%) | High | WASM has broad WebView support |

### Business Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Low native app adoption | High (60%) | Medium | Monitor install rates, have exit criteria |
| Maintenance burden | Medium (25%) | High | Single PWA codebase minimizes this |
| App store policy changes | Medium (25%) | Medium | Monitor policy updates, adapt quickly |
| Negative user reviews | Low (15%) | Medium | Responsive support, quick bug fixes |

---

## 7. Rollback Plan

If native apps underperform or cause issues:

### Short-term (first 30 days)
- **Unpublish apps** from app stores (still available to existing users)
- **Redirect users to PWA** with in-app message: "For the best experience, use drawrace.com"
- **Monitor metrics** - if adoption <5% of PWA users, proceed to full rollback

### Long-term (after 60 days)
- **Deprecate native apps** with 90-day sunset notice in-app
- **Update store descriptions** to direct users to PWA
- **Stop maintaining native wrappers** - keep apps functional but no updates
- **Delete from app stores** after sunset period

### Exit Criteria
Abandon native app strategy if:
- **Native app installs < 10%** of PWA unique visitors after 60 days
- **Maintenance cost > 20% of development time**
- **App store policy changes** make wrappers non-viable

---

## 8. Cost Estimate

### Development Time
- **Capacitor setup:** 8-16 hours
- **Testing:** 24-40 hours
- **App store submission:** 8-16 hours
- **Post-launch monitoring:** 4-8 hours/week

### Total: ~40-80 hours initial + 4-8 hours/week ongoing

### App Store Costs
- **Apple Developer Program:** $99/year
- **Google Play Developer:** $25 (one-time)
- **Total first year:** ~$124

### Opportunity Cost
- **Alternative:** What features could we build in 40-80 hours?
  - Track editor improvements
  - Multiplayer ghost racing
  - Advanced stats and analytics
  - New tracks and game modes

**Recommendation:** Only proceed if data shows strong user demand for native apps.

---

## 9. Recommended Timeline

If install-friction data triggers this work:

| Week | Milestone |
|------|-----------|
| Week 1 | Capacitor setup, build system working |
| Week 2 | Testing across devices, determinism verification |
| Week 3 | App store submission, review process |
| Week 4+ | Post-launch monitoring, iteration |

**Total time to launch:** ~3-4 weeks from start to app store availability

---

## 10. Conclusion

### Recommendation Summary

**Proceed with Capacitor-based native app wrappers IF:**
1. Install-friction data shows PWA conversion <10% OR app store search volume >50/day
2. Sufficient development resources available (40-80 hours)
3. Commitment to ongoing maintenance (4-8 hours/week)

**Use Capacitor (not Expo) because:**
- Preserves 100% of existing PWA code
- Maintains physics determinism across platforms
- Single codebase to maintain
- Faster development timeline (3 weeks vs 2+ months)

### Key Success Factors
1. **Thorough testing** of physics determinism across platforms
2. **Clear messaging** in app store reviews about native features
3. **Ongoing monitoring** of native vs PWA user metrics
4. **Exit criteria** defined before launch

### Next Steps (When Triggered)
1. Review this plan with latest install-friction data
2. Confirm resources available
3. Execute Phase 1 (Capacitor setup)
4. Create bead for implementation work
5. Track progress in task list

---

## Sources

- [Capacitor vs Expo PWA wrapper 2024](https://www.reddit.com/r/capacitor/comments/1h23phe/would_capacitor_be_a_better_option_for_my_app/)
- [WASM Physics Determinism - Rapier.rs](https://rapier.rs/docs/user_guides/javascript/determinism/)
- [Apple App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play Developer Policy Center](https://play.google/developer-content-policy)
- [PWA vs Native App Conversion Statistics 2024](https://www.newstore.com/articles/pwa-vs-native-app/)
- [US App Store Conversion Rates 2024](https://www.businessofapps.com/data/app-store-conversion-rate/)
- [Cross-Platform Determinism with WebAssembly](https://discussions.unity.com/t/cross-platform-determinism-in-unity-using-webassembly/1495296)

---

**Document Status:** ✅ Complete - Ready for execution when trigger criteria are met
