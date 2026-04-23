CREATE TABLE IF NOT EXISTS invite_codes (
    code VARCHAR(32) PRIMARY KEY,
    max_uses INTEGER NOT NULL DEFAULT 1,
    current_uses INTEGER NOT NULL DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_invites (
    player_uuid UUID PRIMARY KEY REFERENCES players(player_uuid),
    invite_code VARCHAR(32) NOT NULL REFERENCES invite_codes(code),
    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed 30 invite codes for beta testing (each usable once)
INSERT INTO invite_codes (code, max_uses) VALUES
    ('BETA-DRAW-001', 1),
    ('BETA-DRAW-002', 1),
    ('BETA-DRAW-003', 1),
    ('BETA-DRAW-004', 1),
    ('BETA-DRAW-005', 1),
    ('BETA-DRAW-006', 1),
    ('BETA-DRAW-007', 1),
    ('BETA-DRAW-008', 1),
    ('BETA-DRAW-009', 1),
    ('BETA-DRAW-010', 1),
    ('BETA-DRAW-011', 1),
    ('BETA-DRAW-012', 1),
    ('BETA-DRAW-013', 1),
    ('BETA-DRAW-014', 1),
    ('BETA-DRAW-015', 1),
    ('BETA-DRAW-016', 1),
    ('BETA-DRAW-017', 1),
    ('BETA-DRAW-018', 1),
    ('BETA-DRAW-019', 1),
    ('BETA-DRAW-020', 1),
    ('BETA-DRAW-021', 1),
    ('BETA-DRAW-022', 1),
    ('BETA-DRAW-023', 1),
    ('BETA-DRAW-024', 1),
    ('BETA-DRAW-025', 1),
    ('BETA-DRAW-026', 1),
    ('BETA-DRAW-027', 1),
    ('BETA-DRAW-028', 1),
    ('BETA-DRAW-029', 1),
    ('BETA-DRAW-030', 1),
    ('BETA-OPEN', 100)
ON CONFLICT DO NOTHING;
