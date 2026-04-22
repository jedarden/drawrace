-- Add s3_key column to submissions table
-- This stores the exact S3 key for the ghost blob,
-- allowing the validator to download it without listing objects.

ALTER TABLE submissions
ADD COLUMN s3_key TEXT NOT NULL DEFAULT '';
