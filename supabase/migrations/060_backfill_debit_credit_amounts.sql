-- Make debit_amount / credit_amount authoritative so reports (P&L, reconciliation,
-- cashflow) never need designer_cost / payment_amount fallbacks.

-- Goods lines: debit = (designer_cost x quantity) + tax.
UPDATE ledger
SET debit_amount = ROUND(
  (COALESCE(designer_cost, 0) * CASE
    WHEN COALESCE(quantity, 0) > 0 THEN quantity
    ELSE 1
  END) + COALESCE(tax_amount, 0),
  2
)
WHERE source_ledger_id IS NULL
  AND COALESCE(designer_cost, 0) > 0
  AND COALESCE(debit_amount, 0) = 0;

-- Payment rows (companions and legacy payment-only lines): credit = payment amount.
-- Parents that already have a companion are skipped so the payment is counted once.
UPDATE ledger AS l
SET credit_amount = ROUND(COALESCE(l.payment_amount, 0), 2)
WHERE COALESCE(l.payment_amount, 0) > 0
  AND COALESCE(l.credit_amount, 0) = 0
  AND NOT EXISTS (
    SELECT 1 FROM ledger c WHERE c.source_ledger_id = l.id
  );

NOTIFY pgrst, 'reload schema';
