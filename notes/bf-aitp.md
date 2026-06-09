# bead bf-aitp: Ghost backfill API client and bucket lookup

## Task Status: Already Completed

The work described in this bead was already completed in commit `7b5dba1` (feat(live): wire ghost backfill API client and bucket lookup).

## Implementation Summary

### 1. Ghost Backfill API Client (`crates/live/src/ghost.rs`)

The `GhostBackfill` struct now implements full HTTP client functionality:

- **HTTP Client**: Uses `reqwest` with 5s timeout, configurable via `DRAWRACE_API_URL` env var
- **Matchmake API Call**: `fetch_ghosts()` calls `/v1/matchmake/{track_id}?player_uuid=...`
- **Ghost Blob Download**: Fetches full replay data from presigned S3 URLs
- **Fallback Handling**: Generates placeholder ghosts when API is unavailable

Key types:
- `MatchmakeResponse`: API response with track_id, player_bucket, target_bucket, ghosts list
- `ApiGhost`: Individual ghost entry (ghost_id, time_ms, name, url)
- `GhostBlob`: S3 blob format (track_id, time_ms, wheel, swaps)
- `GhostReplay`: Simplified replay format for live playback
- `GhostPlayer`: Runtime ghost player with replay data

### 2. Bucket Lookup (`crates/live/src/websocket.rs`)

The `get_player_bucket()` function queries the matchmake API for player's bucket:

- Queries `/v1/matchmake/{track_id}?player_uuid=...`
- Returns `player_bucket` from `BucketLookupResponse`
- Falls back to "novice" on any error (HTTP failure, parse error, timeout)
- 2s timeout for API calls
- Proper error logging at WARN level

Called from `handle_client_message` during `Hello` message processing to assign the correct bucket before room creation.

## Dependencies

- `reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }` added in commit `a76837f`

## Plan Alignment

Per plan §Multiplayer 13 §6:
> "The matchmaker must return a race_url after a timeout and fill empty slots with ghosts from the same bucket."

The implementation provides:
- Ghost fetching from matchmake API
- Bucket-aware ghost assignment (ghosts come from the same bucket as the player)
- Fallback placeholder generation when unavailable
- Proper error handling and logging

## Verification

No code changes required. The implementation is complete and ready for testing with a live drawrace-api instance.
