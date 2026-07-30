-- Split tax, shipping, and payment fees out of the goods line into their own
-- companion records so each cost carries its own CoA Category.
--   tax      -> 214 Taxes and licenses
--   shipping -> 203 commissions and fees
--   fee      -> 203 commissions and fees
-- Companions mirror the amount in debit_amount only. The source columns
-- (tax_amount, shipping_receiving_amount, payment_fee) stay on the parent
-- because customer price, invoiced totals, and S&U tax remittance rely on them.

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS companion_kind TEXT;

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_companion_kind_check;
ALTER TABLE ledger
  ADD CONSTRAINT ledger_companion_kind_check
  CHECK (
    companion_kind IS NULL
    OR companion_kind IN ('payment', 'tax', 'shipping', 'fee')
  );

-- Existing companions are all invoice payments.
UPDATE ledger
SET companion_kind = 'payment'
WHERE source_ledger_id IS NOT NULL
  AND companion_kind IS NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_companion_kind
  ON ledger(source_ledger_id, companion_kind);

-- Only one companion of each kind per parent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_companion_unique
  ON ledger(source_ledger_id, companion_kind)
  WHERE source_ledger_id IS NOT NULL;

-- Goods lines: debit is designer cost only (migration 060 had added tax).
UPDATE ledger
SET debit_amount = ROUND(
  COALESCE(designer_cost, 0) * CASE
    WHEN COALESCE(quantity, 0) > 0 THEN quantity
    ELSE 1
  END,
  2
)
WHERE source_ledger_id IS NULL
  AND COALESCE(designer_cost, 0) > 0;

-- Tax companions.
INSERT INTO ledger (
  entry_date, designer_cost, quantity, credit_debit, description,
  wholesale_retail, trade_partner_id, discount_percent,
  shipping_receiving_amount, retail_price, tax_amount, customer_price,
  client_id, po_number, purchaser, department, coa_category,
  debit_amount, credit_amount, account, invoiced, invoice_id, paid,
  date_paid, paid_to, payment_type, payment_fee, payment_amount,
  expense, expense_amount, income_statement, balance_sheet,
  variance_accepted, variance_amount, variance_notes,
  source_ledger_id, companion_kind
)
SELECT
  p.entry_date, 0, 1, 'debit',
  COALESCE(NULLIF(TRIM(p.description), ''), 'Line') || ' (tax)',
  COALESCE(p.wholesale_retail, 'retail'), NULL, 0,
  0, 0, 0, 0,
  p.client_id, p.po_number, p.purchaser,
  COALESCE(p.department, 'Interior Design'), '214 Taxes and licenses',
  ROUND(COALESCE(p.tax_amount, 0), 2), 0, p.account, false, p.invoice_id, false,
  NULL, NULL, NULL, 0, 0,
  false, 0, true, COALESCE(p.balance_sheet, false),
  false, 0, '',
  p.id, 'tax'
FROM ledger p
WHERE p.source_ledger_id IS NULL
  AND COALESCE(p.tax_amount, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM ledger c
    WHERE c.source_ledger_id = p.id AND c.companion_kind = 'tax'
  );

-- Shipping / receiving companions.
INSERT INTO ledger (
  entry_date, designer_cost, quantity, credit_debit, description,
  wholesale_retail, trade_partner_id, discount_percent,
  shipping_receiving_amount, retail_price, tax_amount, customer_price,
  client_id, po_number, purchaser, department, coa_category,
  debit_amount, credit_amount, account, invoiced, invoice_id, paid,
  date_paid, paid_to, payment_type, payment_fee, payment_amount,
  expense, expense_amount, income_statement, balance_sheet,
  variance_accepted, variance_amount, variance_notes,
  source_ledger_id, companion_kind
)
SELECT
  p.entry_date, 0, 1, 'debit',
  COALESCE(NULLIF(TRIM(p.description), ''), 'Line') || ' (shipping)',
  COALESCE(p.wholesale_retail, 'retail'), NULL, 0,
  0, 0, 0, 0,
  p.client_id, p.po_number, p.purchaser,
  COALESCE(p.department, 'Interior Design'), '203 commissions and fees',
  ROUND(COALESCE(p.shipping_receiving_amount, 0), 2), 0, p.account, false, p.invoice_id, false,
  NULL, NULL, NULL, 0, 0,
  false, 0, true, COALESCE(p.balance_sheet, false),
  false, 0, '',
  p.id, 'shipping'
FROM ledger p
WHERE p.source_ledger_id IS NULL
  AND COALESCE(p.shipping_receiving_amount, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM ledger c
    WHERE c.source_ledger_id = p.id AND c.companion_kind = 'shipping'
  );

-- Payment fee companions. The fee may sit on the payment companion (post-056)
-- or on a standalone payment line; either way it attaches to the goods parent.
INSERT INTO ledger (
  entry_date, designer_cost, quantity, credit_debit, description,
  wholesale_retail, trade_partner_id, discount_percent,
  shipping_receiving_amount, retail_price, tax_amount, customer_price,
  client_id, po_number, purchaser, department, coa_category,
  debit_amount, credit_amount, account, invoiced, invoice_id, paid,
  date_paid, paid_to, payment_type, payment_fee, payment_amount,
  expense, expense_amount, income_statement, balance_sheet,
  variance_accepted, variance_amount, variance_notes,
  source_ledger_id, companion_kind
)
SELECT DISTINCT ON (COALESCE(r.source_ledger_id, r.id))
  COALESCE(r.date_paid, r.entry_date), 0, 1, 'debit',
  COALESCE(NULLIF(TRIM(r.description), ''), 'Line') || ' (payment fee)',
  COALESCE(r.wholesale_retail, 'retail'), NULL, 0,
  0, 0, 0, 0,
  r.client_id, r.po_number, r.purchaser,
  COALESCE(r.department, 'Interior Design'), '203 commissions and fees',
  ROUND(COALESCE(r.payment_fee, 0), 2), 0, r.account, false, r.invoice_id, false,
  NULL, NULL, NULL, 0, 0,
  false, 0, true, COALESCE(r.balance_sheet, false),
  false, 0, '',
  COALESCE(r.source_ledger_id, r.id), 'fee'
FROM ledger r
WHERE COALESCE(r.payment_fee, 0) > 0
  AND r.companion_kind IS DISTINCT FROM 'fee'
  AND NOT EXISTS (
    SELECT 1 FROM ledger c
    WHERE c.source_ledger_id = COALESCE(r.source_ledger_id, r.id)
      AND c.companion_kind = 'fee'
  )
ORDER BY COALESCE(r.source_ledger_id, r.id), r.created_at DESC;

NOTIFY pgrst, 'reload schema';
