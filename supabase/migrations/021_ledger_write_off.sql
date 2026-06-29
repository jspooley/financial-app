ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS write_off BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS write_off_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ledger_write_off ON ledger(write_off);

NOTIFY pgrst, 'reload schema';
