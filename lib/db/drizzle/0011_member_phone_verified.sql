-- Add phone_verified flag to members.
-- Only set to true by the WhatsApp onboarding token flow (proof-of-ownership).
-- Admin-set phones (via API) remain false and are NOT used for inbound routing.
-- Safe to run multiple times (IF NOT EXISTS / DEFAULT).
ALTER TABLE "members"
  ADD COLUMN IF NOT EXISTS "phone_verified" boolean NOT NULL DEFAULT false;
