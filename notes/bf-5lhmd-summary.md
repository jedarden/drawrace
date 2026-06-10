# Native App Wrapper Summary - DrawRace (bf-5lhmd)

## Decision Status

**Result:** ✅ Research Complete - **Capacitor Recommended** (when triggered)

**Trigger Condition:** Proceed only if install-friction data after v1 launch shows PWA conversion rates <10% OR app store search volume >50/day.

---

## Key Findings

### Capacitor vs Expo
**Winner: Capacitor** - Unanimously better for DrawRace's requirements

| Factor | Capacitor | Expo |
|--------|-----------|------|
| Development Time | 2-3 days | 2-3 weeks |
| Code Changes | None (100% PWA reuse) | Full rewrite required |
| Physics Determinism | Identical to PWA | May diverge |
| Maintenance | Single codebase | Two codebases |

### Technical Feasibility
- **Physics Determinism:** ✅ Capacitor WebView preserves WASM execution consistency
- **PWA Features:** ✅ All features (offline, ghosts, leaderboards) work unchanged
- **Performance:** ✅ Minimal overhead, still hardware-accelerated
- **App Size:** ✅ ~5-8MB (well below download limits)

### App Store Compliance
- **Apple:** Low rejection risk (10-20%) - emphasize offline-first native features
- **Google Play:** Straightforward approval process
- **Content Rating:** "Everyone" - no objectionable content

---

## Implementation Timeline (When Triggered)

- **Week 1:** Capacitor setup, working builds
- **Week 2:** Cross-platform testing, determinism verification  
- **Week 3:** App store submission
- **Week 4+:** Post-launch monitoring

**Total: ~3-4 weeks to app store launch**

---

## Cost Estimate

- **Development:** 40-80 hours initial + 4-8 hours/week ongoing
- **App Store Fees:** $124/year (Apple $99 + Google $25)
- **Opportunity Cost:** Could build 2-3 major features instead

---

## Deliverables Created

1. **Comprehensive Evaluation Document** (`notes/bf-5lhmd-native-app-wrapper-evaluation.md`)
   - Full Capacitor vs Expo analysis
   - Physics determinism verification strategy
   - App store compliance requirements
   - Risk assessment and rollback plan
   - Implementation timeline

2. **Quick Start Guide** (`notes/bf-5lhmd-capacitor-quickstart.md`)
   - 15-minute setup process
   - Essential commands
   - Troubleshooting guide

---

## Exit Criteria

Abandon native app strategy if:
- Native installs <10% of PWA visitors after 60 days
- Maintenance cost >20% of development time
- App store policy changes make wrappers non-viable

**Rollback Plan:** Unpublish apps, redirect users to PWA, sunset after 90 days

---

## Next Steps (When Data Triggers This)

1. Review install-friction data against trigger criteria
2. Confirm resource availability (40-80 hours)
3. Execute Capacitor quickstart guide
4. Create implementation bead
5. Begin Phase 1 of implementation plan

---

## Sources

- [Capacitor vs Expo PWA wrapper 2024](https://www.reddit.com/r/capacitor/comments/1h23phe/would_capacitor_be_a_better_option_for_my_app/)
- [WASM Physics Determinism - Rapier.rs](https://rapier.rs/docs/user_guides/javascript/determinism/)
- [Apple App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play Developer Policy Center](https://play.google/developer-content-policy)
- [PWA vs Native App Conversion Statistics 2024](https://www.newstore.com/articles/pwa-vs-native-app/)

---

**Status:** 🟡 Ready to execute - awaiting v1 launch and install-friction data
