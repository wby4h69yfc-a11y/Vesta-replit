-- Add phone_verified flag to members.
-- Only the WhatsApp onboarding token flow (proof-of-ownership) sets this true.
-- Admin-set phones (via API) default false and are NOT used for inbound routing.
-- Safe to run multiple times (IF NOT EXISTS / DEFAULT).
ALTER TABLE "members"
  ADD COLUMN IF NOT EXISTS "phone_verified" boolean NOT NULL DEFAULT false;

-- Backfill: members that have both a phone and a linked user_id were bound via
-- the onboarding flow (the only path that historically set members.phone), so
-- treat them as already-verified for routing continuity after deploy.
-- Members with phone but no user_id are admin-created placeholder records
-- (children, other adults) and correctly stay false.
UPDATE "members"
  SET "phone_verified" = true
  WHERE "phone" IS NOT NULL
    AND "user_id" IS NOT NULL
    AND "phone_verified" = false;
