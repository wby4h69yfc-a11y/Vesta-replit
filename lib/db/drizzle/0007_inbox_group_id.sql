-- Add group_id to inbox_items so messages forwarded via WhatsApp group
-- /vesta commands carry their origin group JID for inbox traceability.
ALTER TABLE "inbox_items"
  ADD COLUMN IF NOT EXISTS "group_id" text;
