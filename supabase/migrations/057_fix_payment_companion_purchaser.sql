-- Payment companions should keep the invoice line purchaser; paid_to is who received cash.
UPDATE ledger AS companion
SET purchaser = parent.purchaser
FROM ledger AS parent
WHERE companion.source_ledger_id = parent.id
  AND companion.purchaser IS DISTINCT FROM parent.purchaser;

NOTIFY pgrst, 'reload schema';
