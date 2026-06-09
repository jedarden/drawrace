# Sound System Refactor — bf-1xsm

## Summary

Replaced Web Audio API synthesis (oscillators, noise buffers) with audio file-based playback per plan §Graphics 14.

## Implementation

### Changes to Sound.ts

The `SoundManager` class now uses authored audio files instead of synthesizing sounds:

**Old approach (Web Audio synthesis):**
- `playTone()` — created oscillator nodes for beeps
- `startMotorHum()` — dual oscillator setup (sawtooth + triangle) for engine rumble
- `playWhoosh()` / `playClear()` — noise buffer generation with filters
- All sounds were procedurally generated at runtime

**New approach (audio file playback):**
- `loadSound()` — fetches and decodes audio files with `.webm` → `.mp4` fallback
- `playOneShot()` — plays pre-loaded audio buffers
- `startMotorHum()` — loops the engine rumble buffer with playback rate modulation
- `updateMotorSpeed()` — modulates engine rumble playback rate (0.7–1.5× based on speed)
- Sounds are loaded lazily on first `saveSettings(true)` call (within user gesture context)

### Audio Assets

Placeholder WAV files created at `/apps/web/public/assets/audio/`:

| File | Purpose | Target budget |
|------|---------|---------------|
| `engine_rumble.wav` | Low-frequency hum, looped, modulated by speed | ≤ 40KB |
| `bounce.wav` | Collision thud | ≤ 10KB |
| `whoosh.wav` | Ink whoosh on wheel commit | ≤ 10KB |
| `finish_fanfare.wav` | Kazoo/ukulele sting | ≤ 10KB |
| `countdown.wav` | Countdown beeps | ≤ 10KB |
| `go.wav` | GO tone (higher pitch) | ≤ 10KB |
| `ui_tap.wav` | Paper tick for CTAs | ≤ 10KB |
| `clear.wav` | Canvas clear sound | ≤ 10KB |
| `dnf.wav` | DNF tone | ≤ 10KB |
| `stroke_closure.wav` | Stroke complete sound | ≤ 10KB |

**Total target budget:** ≤ 120KB

### Current Placeholders

The generated WAV files are minimal sine-wave placeholders to establish the pattern. They are NOT production-ready:

- Created as uncompressed WAV (much larger than target)
- Simple sine waves, not authed sounds
- Don't match the hand-drawn paper aesthetic

## What Remains

### Authored Audio Files Needed

Per plan §Graphics 14, the sounds should be:

1. **Engine rumble (1.2s loop)**
   - "A chattery triangle wheel sounds chattery" — the rumble should reflect wheel geometry
   - Low-frequency hum, looped seamlessly
   - Opus-in-.webm primary, AAC-in-.mp4 fallback
   - ≤ 40KB compressed

2. **Bounce/thud (single-shot)**
   - Collision sound with slight pitch variation per event
   - Soft thud, matches paper aesthetic
   - ≤ 10KB

3. **Ink whoosh (0.3s)**
   - Soft whoosh on wheel-commit animation
   - Sound of tire drawn in ink
   - ≤ 10KB

4. **Finish fanfare (1.5s)**
   - "Tiny orchestral sting in kazoo/ukulele register"
   - NOT triumphant brass — fits the paper aesthetic
   - ≤ 10KB

5. **Countdown ticks (3 beeps + GO)**
   - Three even beeps, higher GO tone
   - ≤ 10KB

6. **UI paper tick (0.04s)**
   - Soft paper "tick" for primary CTAs only
   - ≤ 10KB

### Implementation Notes

- Files should be placed in `/apps/web/public/assets/audio/`
- Provide both `.webm` (Opus) and `.mp4` (AAC) versions
- Engine rumble must loop seamlessly
- Playback rate modulation is handled in `updateMotorSpeed()` (0.7–1.5×)

### Audio Production

A sound designer or audio production tool is needed to create these files. The placeholder script at `scripts/create-placeholder-audio.py` can be used to generate test files, but production files should be authored to match the hand-drawn aesthetic.

## Testing

All existing tests pass. The test suite verifies that:
- Sound starts disabled by default
- Can be enabled/disabled with persistence
- All play* methods don't throw when disabled
- Motor hum lifecycle is safe
- dispose() cleans up without errors

No test changes were needed — the API surface is identical.

## Code Files Changed

- `apps/web/src/Sound.ts` — Complete refactor from synthesis to file playback
- `apps/web/public/assets/audio/` — New directory with placeholder audio files
- `scripts/create-placeholder-audio.py` — Helper script to generate placeholders
