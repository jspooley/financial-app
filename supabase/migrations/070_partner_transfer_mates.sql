-- Partner-to-partner cashflow transfers (303/304, or Paid To the other partner)
-- post a mate row on the other checking account so a Jess debit also shows as a
-- Molly credit. True Up already mirrors these in the report and skips companions
-- (source_ledger_id), so the mate does not double-count the split.

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_companion_kind_check;
ALTER TABLE ledger
  ADD CONSTRAINT ledger_companion_kind_check
  CHECK (
    companion_kind IS NULL
    OR companion_kind IN ('payment', 'tax', 'shipping', 'fee', 'transfer')
  );

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
      THEN 'credit'
    ELSE 'debit'
  END,
  p.description,
  COALESCE(p.wholesale_retail, 'retail'),
  NULL,
  0,
  0,
  0,
  0,
  0,
  p.client_id,
  p.po_number,
  CASE WHEN p.owner = 'Molly' THEN 'Jess' ELSE 'Molly' END,
  COALESCE(p.department, 'Interior Design'),
  p.coa_category,
  COALESCE(p.credit_amount, 0),
  COALESCE(p.debit_amount, 0),
  CASE
    WHEN p.owner = 'Molly' THEN 'Checking - Jess'
    ELSE 'Checking - Molly'
  END,
  NULL,
  false,
  p.invoice_id,
  false,
  NULL,
  p.owner,
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
  'transfer'
FROM (
  SELECT
    ledger.*,
    CASE
      WHEN COALESCE(ledger.account, '') ILIKE '%Molly%' THEN 'Molly'
      WHEN COALESCE(ledger.account, '') ILIKE '%Jess%' THEN 'Jess'
      WHEN ledger.purchaser = 'Molly' THEN 'Molly'
      ELSE 'Jess'
    END AS owner
  FROM ledger
  WHERE source_ledger_id IS NULL
    AND companion_kind IS NULL
) p
WHERE (
    (
      lower(COALESCE(p.coa_category, '')) LIKE '%jess%'
      AND lower(COALESCE(p.coa_category, '')) LIKE '%molly%'
    )
    OR (
      p.paid_to IN ('Jess', 'Molly')
      AND p.paid_to IS DISTINCT FROM p.owner
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM ledger c
    WHERE c.source_ledger_id = p.id
      AND c.companion_kind = 'transfer'
  );

NOTIFY pgrst, 'reload schema';
