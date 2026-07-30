-- Payment (Sales Income) rows should land in Checking for who was paid,
-- not the purchase Credit Card account copied from the invoice line.
UPDATE ledger
SET account = CASE
  WHEN paid_to = 'Molly' THEN 'Checking - Molly'
  ELSE 'Checking - Jess'
END
WHERE coa_category = '100 Sales Income'
  AND (
    source_ledger_id IS NOT NULL
    OR (
      expense_type IS NULL
      AND COALESCE(payment_amount, 0) > 0
    )
  )
  AND (
    account IS NULL
    OR account LIKE 'Credit Card%'
  );

NOTIFY pgrst, 'reload schema';
