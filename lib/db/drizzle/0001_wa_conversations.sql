-- wa_conversations: DB-backed WA conversation state machine
-- Stores one row per (household_id, sender_phone) open conversation.
-- States: awaiting_confirmation | awaiting_edit | completed | dismissed
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wa_conversations" (
  "id" serial PRIMARY KEY NOT NULL,
  "household_id" integer NOT NULL,
  "sender_phone" text NOT NULL,
  "thread_id" text,
  "state" text DEFAULT 'awaiting_confirmation' NOT NULL,
  "pending_action_id" integer,
  "proposed_payload" jsonb,
  "thread_context" text DEFAULT 'approval',
  "last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wa_conversations" ADD COLUMN IF NOT EXISTS "thread_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wa_conversations"
    ADD CONSTRAINT "wa_conversations_pending_action_id_fk"
    FOREIGN KEY ("pending_action_id") REFERENCES "suggested_actions"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_conversations_lookup_idx"
  ON "wa_conversations" ("household_id", "sender_phone", "state", "expires_at");
