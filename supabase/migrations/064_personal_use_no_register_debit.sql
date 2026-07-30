-- Personal use (balance sheet) GOODS purchases are paid with personal funds,
-- so no business cash leaves the account. Migrations 060/061 gave those lines a
-- register debit equal to designer cost x qty, which overstated cash out.
--
-- IMPORTANT: only goods lines (client_id / designer_cost / invoice / po signals).
-- Cashflow expenses also use balance_sheet=true by default — wiping those would
-- erase real register debits (e.g. subscriptions). See migration 066 if that
-- already happened.

UPDATE ledger
SET debit_amount = 0
WHERE COALESCE(balance_sheet, false) = true
  AND COALESCE(debit_amount, 0) <> 0
  AND source_ledger_id IS NULL
  AND (
    client_id IS NOT NULL
    OR COALESCE(designer_cost, 0) > 0
    OR COALESCE(invoiced, false) = true
    OR NULLIF(TRIM(COALESCE(invoice_id, '')), '') IS NOT NULL
    OR NULLIF(TRIM(COALESCE(po_number, '')), '') IS NOT NULL
  );

NOTIFY pgrst, 'reload schema';
