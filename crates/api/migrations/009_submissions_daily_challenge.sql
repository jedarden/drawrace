-- Add daily_challenge_date column to submissions table
-- This allows the validator to link accepted ghosts to daily challenges
ALTER TABLE submissions
ADD COLUMN IF NOT EXISTS daily_challenge_date DATE REFERENCES daily_challenges(challenge_date) ON DELETE SET NULL;

-- Index for looking up daily challenge submissions
CREATE INDEX idx_submissions_daily_challenge ON submissions (daily_challenge_date)
WHERE daily_challenge_date IS NOT NULL;
