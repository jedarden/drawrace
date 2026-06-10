-- Community tracks table for user-submitted tracks
CREATE TABLE IF NOT EXISTS community_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    track_id TEXT NOT NULL UNIQUE,
    player_uuid UUID NOT NULL REFERENCES players(player_uuid) ON DELETE CASCADE,
    track_data JSONB NOT NULL,
    s3_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'published', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ
);

CREATE INDEX idx_community_tracks_status ON community_tracks (status);
CREATE INDEX idx_community_tracks_player ON community_tracks (player_uuid);
