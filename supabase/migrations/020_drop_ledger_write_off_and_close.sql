DROP INDEX IF EXISTS idx_ledger_write_off_and_close;

ALTER TABLE ledger
  DROP COLUMN IF EXISTS write_off_and_close;

NOTIFY pgrst, 'reload schema';
