-- Separate receiving from shipping on goods lines. Receiving is billed to the
-- client like shipping but posts to its own 203 commissions and fees companion.

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS receiving_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_companion_kind_check;
ALTER TABLE ledger
  ADD CONSTRAINT ledger_companion_kind_check
  CHECK (
    companion_kind IS NULL
    OR companion_kind IN (
      'payment',
      'tax',
      'shipping',
      'receiving',
      'fee',
      'transfer',
      'card_reimburse'
    )
  );

INSERT INTO ledger (
  entry_date, designer_cost, quantity, credit_debit, description,
  wholesale_retail, trade_partner_id, discount_percent,
  shipping_receiving_amount, receiving_amount, retail_price, tax_amount, customer_price,
  client_id, po_number, purchaser, department, coa_category,
  debit_amount, credit_amount, account, invoiced, invoice_id, paid,
  date_paid, paid_to, payment_type, payment_fee, payment_amount,
  expense, expense_amount, income_statement, balance_sheet,
  variance_accepted, variance_amount, variance_notes,
  source_ledger_id, companion_kind
)
SELECT
  p.entry_date, 0, 1, 'debit',
  COALESCE(NULLIF(TRIM(p.description), ''), 'Line') || ' (receiving)',
  COALESCE(p.wholesale_retail, 'retail'), NULL, 0,
  0, 0, 0, 0, 0,
  p.client_id, p.po_number, p.purchaser,
  COALESCE(p.department, 'Interior Design'), '203 commissions and fees',
  ROUND(COALESCE(p.receiving_amount, 0), 2), 0, p.account, false, p.invoice_id, false,
  NULL, NULL, NULL, 0, 0,
  false, 0, true, COALESCE(p.balance_sheet, false),
  false, 0, '',
  p.id, 'receiving'
FROM ledger p
WHERE p.source_ledger_id IS NULL
  AND COALESCE(p.receiving_amount, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM ledger c
    WHERE c.source_ledger_id = p.id AND c.companion_kind = 'receiving'
  );

NOTIFY pgrst, 'reload schema';
