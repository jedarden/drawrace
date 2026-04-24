-- Wheel swaps: add wheel_count column and mark legacy ghosts.
--
-- The ghost blob binary format changed from a single polygon_vertices field
-- to a wheels[] array (v2). Existing ghosts were written with the v1 layout
-- (physics_version = 1) and are marked as legacy so the server knows to
-- skip body parsing on those blobs.

-- Add wheel_count column with default 1 (single wheel = no swaps).
ALTER TABLE ghosts
    ADD COLUMN wheel_count SMALLINT NOT NULL DEFAULT 1
    CHECK (wheel_count BETWEEN 1 AND 21);

-- Backfill existing rows: all legacy ghosts have exactly 1 wheel.
-- (The column was created with DEFAULT 1, so existing rows already have 1.
--  This UPDATE is a no-op but makes the intent explicit.)
UPDATE ghosts SET wheel_count = 1 WHERE wheel_count = 1;

-- Mark all pre-swaps ghosts as legacy (physics_version < 2).
UPDATE ghosts SET is_legacy = true WHERE physics_version < 2;
