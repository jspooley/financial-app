-- Payment tracking fields for ledger debits
-- Run in Supabase SQL Editor.

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS date_paid DATE;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS paid_to purchaser_type;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS payment_type TEXT
  CHECK (payment_type IN ('Cash', 'Check', 'CC', 'Other'));

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS payment_fee NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ledger_paid ON ledger(paid);

NOTIFY pgrst, 'reload schema';
