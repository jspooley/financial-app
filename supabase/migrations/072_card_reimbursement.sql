-- 1:1 personal credit-card reimbursement: link a tagged card charge to the
-- checking 302 that paid it, and post a credit mate on the card so the card
-- register drops when checking reimburses.

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_companion_kind_check;
ALTER TABLE ledger
  ADD CONSTRAINT ledger_companion_kind_check
  CHECK (
    companion_kind IS NULL
    OR companion_kind IN (
      'payment',
      'tax',
      'shipping',
      'fee',
      'transfer',
      'card_reimburse'
    )
  );

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS reimbursed_by_ledger_id UUID REFERENCES ledger(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_reimbursed_by_ledger_id_uidx
  ON ledger (reimbursed_by_ledger_id)
  WHERE reimbursed_by_ledger_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_reimbursed_by_ledger_id
  ON ledger (reimbursed_by_ledger_id)
  WHERE reimbursed_by_ledger_id IS NOT NULL;

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
  expense_type,
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
  source_ledger_id,
  companion_kind
)
SELECT
  p.entry_date,
  0,
  1,
  CASE
    WHEN COALESCE(p.debit_amount, 0) >= COALESCE(p.credit_amount, 0)
      THEN 'credit'::credit_debit_type
    ELSE 'debit'::credit_debit_type
  END,
  p.description,
  COALESCE(p.wholesale_retail, 'retail'::wholesale_retail_type),
  NULL,
  0,
  0,
  0,
  0,
  0,
  p.client_id,
  p.po_number,
  p.purchaser,
  COALESCE(p.department, 'Interior Design'),
  p.coa_category,
  COALESCE(p.credit_amount, 0),
  COALESCE(p.debit_amount, 0),
  CASE
    WHEN COALESCE(p.account, '') ILIKE '%Molly%' THEN 'Credit Card - Molly'
    ELSE 'Credit Card - Jess'
  END,
  NULL,
  false,
  p.invoice_id,
  false,
  NULL,
  p.paid_to,
  NULL,
  0,
  0,
  false,
  0,
  p.income_statement,
  p.balance_sheet,
  false,
  0,
  '',
  p.id,
  'card_reimburse'
FROM ledger p
WHERE p.source_ledger_id IS NULL
  AND p.companion_kind IS NULL
  AND COALESCE(p.account, '') ILIKE 'Checking%'
  AND (
    p.coa_category LIKE '302%'
    OR lower(COALESCE(p.coa_category, '')) LIKE '%paying a credit card%'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM ledger c
    WHERE c.source_ledger_id = p.id
      AND c.companion_kind = 'card_reimburse'
  );

NOTIFY pgrst, 'reload schema';
