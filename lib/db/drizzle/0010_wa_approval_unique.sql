-- Enforce at most one active approval prompt per sender per household.
-- A partial unique index on (household_id, sender_phone) scoped to
-- thread_context='approval' AND state='awaiting_confirmation' makes the
-- INSERT ... ON CONFLICT DO NOTHING pattern atomically safe, preventing
-- duplicate interactive button sets when rapid-fire messages arrive.
CREATE UNIQUE INDEX IF NOT EXISTS "wa_conversations_approval_unique_idx"
  ON "wa_conversations" (household_id, sender_phone)
  WHERE thread_context = 'approval' AND state = 'awaiting_confirmation';
