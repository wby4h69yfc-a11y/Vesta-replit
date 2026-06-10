-- Add optional location field to calendar_events so Google Calendar events
-- with a venue can surface the location in WhatsApp calendar query replies.
ALTER TABLE "calendar_events"
  ADD COLUMN IF NOT EXISTS "location" text;
