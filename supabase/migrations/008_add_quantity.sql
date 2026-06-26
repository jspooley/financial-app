-- Add quantity to ledger (required for saving qty from the form)
ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS quantity NUMERIC(12, 2) NOT NULL DEFAULT 1;

NOTIFY pgrst, 'reload schema';
