-- Add Lowes CC - Jess as a selectable cashflow / purchase account.

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_account_check;
ALTER TABLE ledger
  ADD CONSTRAINT ledger_account_check
  CHECK (
    account IS NULL OR account IN (
      'Checking - Jess',
      'Checking - Molly',
      'Credit Card - Jess',
      'Lowes CC - Jess',
      'Credit Card - Molly',
      'TBD'
    )
  );

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_moved_from_account_check;
ALTER TABLE ledger
  ADD CONSTRAINT ledger_moved_from_account_check
  CHECK (
    moved_from_account IS NULL OR moved_from_account IN (
      'Checking - Jess',
      'Checking - Molly',
      'Credit Card - Jess',
      'Lowes CC - Jess',
      'Credit Card - Molly'
    )
  );

NOTIFY pgrst, 'reload schema';
