-- Payment obligations table
CREATE TABLE IF NOT EXISTS payment_obligations (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL,
  source_inbox_id INTEGER,
  description TEXT NOT NULL,
  recipient TEXT,
  amount_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'BRL',
  due_date TEXT,
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  recurrence_pattern TEXT,
  owner_id INTEGER,
  paid_by_id INTEGER,
  reimbursement_owed_by_id INTEGER,
  payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  proof_url TEXT,
  reimbursement_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_obligations_household_idx ON payment_obligations (household_id, status);
CREATE INDEX IF NOT EXISTS payment_obligations_reimbursement_idx ON payment_obligations (household_id, reimbursement_owed_by_id);

-- Payment columns on tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payment_status TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payment_amount_cents INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payment_currency TEXT DEFAULT 'BRL';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payment_due_date TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS proof_attachment_url TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reimbursement_note TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reimbursement_owed_by INTEGER;

-- Payment data column on suggested_actions
ALTER TABLE suggested_actions ADD COLUMN IF NOT EXISTS payment_data JSONB;

-- Backlink column so tasks can reference their payment obligation
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payment_obligation_id INTEGER;
