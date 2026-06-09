# bead bf-aitp: Ghost backfill API client and bucket lookup

## Summary

The work described in this bead was already completed in commit `7b5dba1` (feat(live): wire ghost backfill API client and bucket lookup). This bead verifies and documents the implementation.

## Implementation Details

### 1. Ghost Backfill API Client (`crates/live/src/ghost.rs`)

The `GhostBackfill::fetch_ghosts()` method implements full HTTP client functionality:

- **API Endpoint**: `GET /v1/matchmake/{track_id}?player_uuid=...`
- **Ghost Retrieval**: Calls matchmake API to get list of ghosts with S3 presigned URLs
- **Blob Download**: Fetches full replay data from S3 for each ghost
- **Fallback**: Generates placeholder ghosts when API unavailable or insufficient ghosts
- **Configurable**: Uses `DRAWRACE_API_URL` env var (defaults to `http://127.0.0.1:3000`)

### 2. Bucket Lookup (`crates/live/src/websocket.rs`)

The `get_player_bucket()` function queries the matchmake API for player's skill bucket:

- **API Endpoint**: `GET /v1/matchmake/{track_id}?player_uuid=...`
- **Response**: Extracts `player_bucket` from `BucketLookupResponse`
- **Fallback**: Returns "novice" on HTTP errors, parse errors, or timeouts
- **Timeout**: 2s timeout for API calls
- **Usage**: Called during `Hello` message processing to assign bucket before room creation

### Dependencies

- `reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }` added in commit `a76837f`

## Retrospective

- **What worked:** The existing implementation correctly calls the drawrace-api matchmake endpoint for both ghost fetching and bucket lookup. Error handling is robust with sensible fallbacks.
- **What didn't:** N/A - implementation was already complete.
- **Surprise:** The bead description mentioned "two TODOs" but no TODOs were found in the code - they had already been implemented in prior commits.
- **Reusable pattern:** The pattern of using placeholder fallbacks when external APIs are unavailable makes the system resilient to API failures while still providing core functionality.

## Plan Alignment

Per plan §Multiplayer 13 §6:
> "The matchmaker must return a race_url after a timeout and fill empty slots with ghosts from the same bucket."

The implementation provides:
- Ghost fetching from matchmake API with S3 blob download
- Bucket-aware ghost assignment (ghosts come from player's bucket)
- Fallback placeholder generation when API unavailable
- Proper error handling and logging
