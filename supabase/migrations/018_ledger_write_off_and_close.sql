ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS write_off_and_close BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ledger_write_off_and_close ON ledger(write_off_and_close);

NOTIFY pgrst, 'reload schema';
