-- Add claimed_at timestamp to wa_onboarding_sessions so a short grace window
-- can be implemented for double-tap / two-tab magic sign-in links.
-- First claim stamps this column; repeat claims within 10 s return 200.
-- After the grace window the row is invalidated (magic_token → null).
ALTER TABLE "wa_onboarding_sessions"
  ADD COLUMN IF NOT EXISTS "magic_token_claimed_at" timestamptz;
