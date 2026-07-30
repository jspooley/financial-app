-- Companions copy invoice_id / po_number from their parent when created. Lines
-- invoiced *after* the payment was recorded left the companion holding a stale
-- (usually NULL) invoice_id, which breaks Cashflow grouping by invoice.
-- Re-sync every companion to its parent.

UPDATE ledger AS c
SET
  invoice_id = p.invoice_id,
  po_number = p.po_number
FROM ledger AS p
WHERE c.source_ledger_id = p.id
  AND (
    c.invoice_id IS DISTINCT FROM p.invoice_id
    OR c.po_number IS DISTINCT FROM p.po_number
  );

NOTIFY pgrst, 'reload schema';
