ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS shortfall_accepted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS shortfall_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ledger_shortfall_accepted ON ledger(shortfall_accepted);

NOTIFY pgrst, 'reload schema';
