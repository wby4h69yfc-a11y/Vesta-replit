-- Migration: service reliability fields for household contacts (§19.3)
-- Adds provider tracking columns to the contacts table.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS service_category       TEXT,
  ADD COLUMN IF NOT EXISTS reliability_status     TEXT NOT NULL DEFAULT 'untested',
  ADD COLUMN IF NOT EXISTS last_used_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_price_range       TEXT,
  ADD COLUMN IF NOT EXISTS no_show_count          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_notes          TEXT,
  ADD COLUMN IF NOT EXISTS household_rating       INTEGER,
  ADD COLUMN IF NOT EXISTS reliability_notes      TEXT,
  ADD COLUMN IF NOT EXISTS last_rating            TEXT;

CREATE INDEX IF NOT EXISTS contacts_provider_idx
  ON contacts (household_id, service_category, reliability_status)
  WHERE service_category IS NOT NULL;
