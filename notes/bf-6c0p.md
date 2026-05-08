# Task bf-6c0p: Recovery phrase for UUID-based identity persistence

## Status: Already Complete

This task was already completed in commit `c929260` on 2026-05-08.

## Implementation Summary

The 4-word BIP39 recovery phrase system was fully implemented with:

### Core Module (`recovery-phrase.ts`)
- 4-word BIP39 chunk generation (32-bit entropy from first 256 BIP39 words)
- localStorage persistence (`drawrace.recovery_phrase`, `drawrace.recovery_phrase_shown`)
- Validation and formatting utilities
- First-race detection via `wasRecoveryPhraseShown()`

### ResultScreen Integration
- "Claim a name" chip shown after first accepted race
- Auto-shows recovery phrase modal on first accepted verdict
- Copy-to-clipboard functionality

### Settings Integration  
- Recovery phrase section with Show/Restore functionality
- Display modal with copy-to-clipboard
- Restoration modal (UI complete, server-side validation deferred to post-v1)

### Test Coverage
- 14 tests covering generation, validation, storage, and first-race detection
- All tests passing

## Deferred Items (Post-v1)
- Server-side restoration via `POST /v1/names` with recovery phrase validation

## Files Changed (in original commit)
- apps/web/src/ResultScreen.tsx (+138 lines)
- apps/web/src/SettingsScreen.tsx (+290 lines)
- apps/web/src/recovery-phrase.test.ts (+100 lines)
- apps/web/src/recovery-phrase.ts (+164 lines)
- apps/web/src/test-setup.ts (+35 lines)
- vitest.config.ts (+1 line)
