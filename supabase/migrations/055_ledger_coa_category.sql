-- Chart of Accounts category on ledger lines.
ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS coa_category TEXT;

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_coa_category_fkey;
ALTER TABLE ledger
  ADD CONSTRAINT ledger_coa_category_fkey
  FOREIGN KEY (coa_category) REFERENCES chart_of_accounts(category)
  ON UPDATE CASCADE
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_coa_category ON ledger(coa_category);

NOTIFY pgrst, 'reload schema';
