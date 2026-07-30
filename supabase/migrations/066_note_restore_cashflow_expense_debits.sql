-- Repair classifications affected by the old Cashflow form default.
-- 200-series CoA rows are income-statement operating expenses, not balance
-- sheet entries. This does not guess their lost cash amounts.
UPDATE ledger
SET
  balance_sheet = false,
  income_statement = true
WHERE source_ledger_id IS NULL
  AND coa_category ~ '^2[0-9]{2}( |$)';

-- Lost amounts are never guessed here — they are re-entered by hand on Cashflow.
-- Zero-value manual rows need their original amounts recovered from
-- a bank/card statement or Supabase backup. Personal-use goods are omitted:
-- their zero register amount is intentional.
SELECT
  id,
  entry_date,
  description,
  coa_category,
  account,
  balance_sheet,
  updated_at
FROM ledger
WHERE source_ledger_id IS NULL
  AND COALESCE(debit_amount, 0) = 0
  AND COALESCE(credit_amount, 0) = 0
  AND COALESCE(designer_cost, 0) = 0
ORDER BY entry_date DESC, description;
