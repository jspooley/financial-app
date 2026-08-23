-- Remember the original register when a ledger row is moved between accounts
-- (e.g. a personal credit-card charge that was booked on Checking). The next
-- reimbursement step uses this to find charges that used to live on checking.

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS moved_from_account TEXT;

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_moved_from_account_check;
ALTER TABLE ledger
  ADD CONSTRAINT ledger_moved_from_account_check
  CHECK (
    moved_from_account IS NULL OR moved_from_account IN (
      'Checking - Jess',
      'Checking - Molly',
      'Credit Card - Jess',
      'Credit Card - Molly'
    )
  );

CREATE INDEX IF NOT EXISTS idx_ledger_moved_from_account
  ON ledger (moved_from_account)
  WHERE moved_from_account IS NOT NULL;

NOTIFY pgrst, 'reload schema';
