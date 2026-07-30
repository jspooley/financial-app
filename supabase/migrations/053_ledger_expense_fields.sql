-- Operating expense fields on ledger (from cashflow).
ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS expense_type TEXT;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS account TEXT;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS debit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS credit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_expense_type_check;
ALTER TABLE ledger
  ADD CONSTRAINT ledger_expense_type_check
  CHECK (
    expense_type IS NULL OR expense_type IN (
      'admin',
      'travel',
      'meals',
      'advertising',
      'office expense',
      'supplies',
      'tax & License',
      'fees',
      'subscriptions',
      'COGS',
      'Issuing Debt',
      'Repaying Debt',
      'Accounts Receivable'
    )
  );

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_account_check;
ALTER TABLE ledger
  ADD CONSTRAINT ledger_account_check
  CHECK (
    account IS NULL OR account IN (
      'Checking - Jess',
      'Checking - Molly',
      'Credit Card - Jess',
      'Credit Card - Molly'
    )
  );

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_debit_credit_non_negative;
ALTER TABLE ledger
  ADD CONSTRAINT ledger_debit_credit_non_negative
  CHECK (debit_amount >= 0 AND credit_amount >= 0);

-- Expense-only rows do not require a client.
ALTER TABLE ledger
  ALTER COLUMN client_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_expense_type ON ledger(expense_type);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger(account);

NOTIFY pgrst, 'reload schema';
