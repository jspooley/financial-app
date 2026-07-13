ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS income_statement BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS balance_sheet BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ledger_income_statement ON ledger(income_statement);
CREATE INDEX IF NOT EXISTS idx_ledger_balance_sheet ON ledger(balance_sheet);

NOTIFY pgrst, 'reload schema';
