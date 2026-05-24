-- Recovery phrase system for cross-device identity restore
-- Adds SHA-256 hash of 4-word BIP39 recovery phrase to names table
ALTER TABLE names ADD COLUMN recovery_phrase_hash TEXT;
CREATE INDEX idx_names_recovery_phrase_hash ON names(recovery_phrase_hash) WHERE recovery_phrase_hash IS NOT NULL;
