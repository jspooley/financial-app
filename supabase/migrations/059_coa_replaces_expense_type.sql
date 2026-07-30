-- Prefer CoA Category over duplicate expense_type for cashflow classification.
-- Seed categories that map from former expense types, backfill CoA, then clear expense_type.

INSERT INTO chart_of_accounts (category)
VALUES
  ('217 Subscriptions'),
  ('218 Issuing Debt'),
  ('219 Repaying Debt'),
  ('220 Accounts Receivable')
ON CONFLICT (category) DO NOTHING;

-- Backfill missing CoA from legacy expense_type (only when CoA is unset).
UPDATE ledger
SET coa_category = CASE expense_type
  WHEN 'admin' THEN '210 Office Expense'
  WHEN 'travel' THEN '215 Travel'
  WHEN 'meals' THEN '216 Deductible meals'
  WHEN 'advertising' THEN '200 advertising'
  WHEN 'office expense' THEN '210 Office Expense'
  WHEN 'supplies' THEN '212 Supplies'
  WHEN 'tax & License' THEN '214 Taxes and licenses'
  WHEN 'fees' THEN '203 commissions and fees'
  WHEN 'subscriptions' THEN '217 Subscriptions'
  WHEN 'COGS' THEN '101 COGS'
  WHEN 'Issuing Debt' THEN '218 Issuing Debt'
  WHEN 'Repaying Debt' THEN '219 Repaying Debt'
  WHEN 'Accounts Receivable' THEN '220 Accounts Receivable'
  ELSE coa_category
END
WHERE expense_type IS NOT NULL
  AND (coa_category IS NULL OR btrim(coa_category) = '');

-- Classification now lives on coa_category; clear the duplicate flag.
UPDATE ledger
SET expense_type = NULL
WHERE expense_type IS NOT NULL;

NOTIFY pgrst, 'reload schema';
