-- WF-20: Create creche_waitlists table for waitlist tracking
CREATE TABLE IF NOT EXISTS "creche_waitlists" (
  "id" serial PRIMARY KEY,
  "household_id" integer NOT NULL,
  "creche_name" text NOT NULL,
  "child_id" integer REFERENCES "members"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'waiting',
  "registered_at" date,
  "estimated_call_date" date,
  "next_followup_at" timestamp with time zone,
  "document_checklist" jsonb DEFAULT '[]'::jsonb,
  "notes" text,
  "source_inbox_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "creche_waitlists_household_status_idx"
  ON "creche_waitlists"("household_id", "status");

-- WF-22/WF-24: Add cascade_type to action_cascades for differentiated inbox rendering
ALTER TABLE "action_cascades"
  ADD COLUMN IF NOT EXISTS "cascade_type" text NOT NULL DEFAULT 'standard';
