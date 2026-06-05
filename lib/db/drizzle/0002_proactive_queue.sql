-- Migration: proactive_message_queue table + household digest preference columns
-- Idempotent: safe to run multiple times

-- ── proactive_message_queue ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "proactive_message_queue" (
  "id" serial PRIMARY KEY NOT NULL,
  "household_id" integer NOT NULL,
  "user_id" text,
  "trigger_type" text NOT NULL,
  "trigger_source_id" integer,
  "template_name" text,
  "payload" jsonb,
  "scheduled_at" timestamp with time zone NOT NULL,
  "sent_at" timestamp with time zone,
  "status" text DEFAULT 'queued' NOT NULL,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "user_replied" boolean DEFAULT false NOT NULL,
  "user_acted" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proactive_queue_household_scheduled_status_idx"
  ON "proactive_message_queue" ("household_id", "scheduled_at", "status");

-- ── households: digest preference columns ─────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "households" ADD COLUMN IF NOT EXISTS "digest_enabled" boolean DEFAULT true NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "households" ADD COLUMN IF NOT EXISTS "digest_paused_until" timestamp with time zone;
EXCEPTION WHEN others THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "households" ADD COLUMN IF NOT EXISTS "digest_stopped" boolean DEFAULT false NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;
