-- Link cashflow payment (Sales Income) rows back to the invoice ledger line.
ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS source_ledger_id UUID REFERENCES ledger(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_ledger_source_ledger_id ON ledger(source_ledger_id);

-- Goods / services lines with designer cost → CoA COGS + debit = designer cost × qty + tax.
UPDATE ledger
SET
  coa_category = '101 COGS',
  debit_amount = ROUND(
    (COALESCE(designer_cost, 0) * COALESCE(quantity, 1)) + COALESCE(tax_amount, 0),
    2
  )
WHERE expense_type IS NULL
  AND source_ledger_id IS NULL
  AND COALESCE(designer_cost, 0) > 0
  AND (
    coa_category IS DISTINCT FROM '101 COGS'
    OR debit_amount IS DISTINCT FROM ROUND(
      (COALESCE(designer_cost, 0) * COALESCE(quantity, 1)) + COALESCE(tax_amount, 0),
      2
    )
  );

-- Split rows that currently hold both designer cost and a payment into a companion Sales Income row.
INSERT INTO ledger (
  entry_date,
  designer_cost,
  quantity,
  credit_debit,
  description,
  wholesale_retail,
  trade_partner_id,
  discount_percent,
  shipping_receiving_amount,
  retail_price,
  tax_amount,
  customer_price,
  client_id,
  po_number,
  purchaser,
  department,
  coa_category,
  debit_amount,
  credit_amount,
  account,
  invoiced,
  invoice_id,
  paid,
  date_paid,
  paid_to,
  payment_type,
  payment_fee,
  payment_amount,
  expense,
  expense_amount,
  income_statement,
  balance_sheet,
  variance_accepted,
  variance_amount,
  variance_notes,
  source_ledger_id
)
SELECT
  COALESCE(l.date_paid, l.entry_date),
  0,
  1,
  'credit',
  COALESCE(NULLIF(TRIM(l.description), ''), 'Payment') || ' (payment)',
  COALESCE(l.wholesale_retail, 'retail'),
  NULL,
  0,
  0,
  0,
  0,
  0,
  l.client_id,
  l.po_number,
  COALESCE(l.paid_to, l.purchaser),
  COALESCE(l.department, 'Interior Design'),
  '100 Sales Income',
  0,
  ROUND(COALESCE(l.payment_amount, 0), 2),
  l.account,
  false,
  l.invoice_id,
  true,
  l.date_paid,
  l.paid_to,
  l.payment_type,
  COALESCE(l.payment_fee, 0),
  ROUND(COALESCE(l.payment_amount, 0), 2),
  false,
  0,
  true,
  false,
  false,
  0,
  '',
  l.id
FROM ledger l
WHERE l.expense_type IS NULL
  AND l.source_ledger_id IS NULL
  AND COALESCE(l.designer_cost, 0) > 0
  AND COALESCE(l.payment_amount, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM ledger c WHERE c.source_ledger_id = l.id
  );

-- Clear payment fields from goods lines that now have a companion payment row.
UPDATE ledger AS parent
SET
  payment_amount = 0,
  payment_fee = 0,
  date_paid = NULL,
  paid_to = NULL,
  payment_type = NULL
WHERE parent.expense_type IS NULL
  AND parent.source_ledger_id IS NULL
  AND COALESCE(parent.designer_cost, 0) > 0
  AND EXISTS (
    SELECT 1 FROM ledger c WHERE c.source_ledger_id = parent.id
  );

-- Payment-only lines (no designer cost) → Sales Income + credit = payment amount.
UPDATE ledger
SET
  coa_category = '100 Sales Income',
  credit_amount = ROUND(COALESCE(payment_amount, 0), 2)
WHERE expense_type IS NULL
  AND source_ledger_id IS NULL
  AND COALESCE(designer_cost, 0) <= 0
  AND COALESCE(payment_amount, 0) > 0;

-- Fix backfilled payment companions that incorrectly copied paid_to into purchaser.
UPDATE ledger AS companion
SET purchaser = parent.purchaser
FROM ledger AS parent
WHERE companion.source_ledger_id = parent.id
  AND companion.purchaser IS DISTINCT FROM parent.purchaser;
