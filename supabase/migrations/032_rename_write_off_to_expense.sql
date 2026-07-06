-- Rename write-off columns to expense terminology (data preserved).
ALTER TABLE ledger RENAME COLUMN write_off TO expense;

ALTER TABLE ledger RENAME COLUMN write_off_amount TO expense_amount;

-- Index name is a separate object; column rename does not rename the index.
ALTER INDEX IF EXISTS idx_ledger_write_off RENAME TO idx_ledger_expense;

NOTIFY pgrst, 'reload schema';
