-- Create action_cascades grouping table
CREATE TABLE IF NOT EXISTS "action_cascades" (
  "id" serial PRIMARY KEY,
  "household_id" integer NOT NULL,
  "source_inbox_id" integer NOT NULL,
  "trigger_description" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Add cascade_id FK to suggested_actions
ALTER TABLE "suggested_actions"
  ADD COLUMN IF NOT EXISTS "cascade_id" integer
  REFERENCES "action_cascades"("id") ON DELETE SET NULL;

-- Drop the single-row-per-inbox-item unique constraint so cascades can
-- insert multiple actions for the same inbox item
DROP INDEX IF EXISTS "suggested_actions_inbox_item_id_unique";
