-- Migration 0003: per-household quiet hours
ALTER TABLE households ADD COLUMN IF NOT EXISTS quiet_hour_start integer NOT NULL DEFAULT 21;
ALTER TABLE households ADD COLUMN IF NOT EXISTS quiet_hour_end integer NOT NULL DEFAULT 7;
