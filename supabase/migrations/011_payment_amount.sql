-- Payment amount for ledger payment tracking
-- Run in Supabase SQL Editor.

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
