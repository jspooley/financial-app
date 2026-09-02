-- Allow TBD on purchaser and purchase account for lines entered before purchase.

ALTER TYPE purchaser_type ADD VALUE IF NOT EXISTS 'TBD';

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_account_check;
ALTER TABLE ledger
  ADD CONSTRAINT ledger_account_check
  CHECK (
    account IS NULL OR account IN (
      'Checking - Jess',
      'Checking - Molly',
      'Credit Card - Jess',
      'Credit Card - Molly',
      'TBD'
    )
  );

NOTIFY pgrst, 'reload schema';
