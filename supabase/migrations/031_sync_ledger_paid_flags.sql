-- Backfill ledger.paid from balance math (approximation; write-off edge cases may need app sync).
-- Run migration 031 in Supabase SQL Editor, or use Reconciliation → "Sync paid flags from balance".

UPDATE ledger
SET paid = true
WHERE credit_debit = 'debit'
  AND paid = false
  AND (
    COALESCE(payment_amount, 0) + COALESCE(payment_fee, 0)
    + CASE WHEN write_off THEN COALESCE(write_off_amount, 0) ELSE 0 END
  ) >= (
    COALESCE(customer_price, 0)
    + CASE WHEN wholesale_retail = 'wholesale' THEN COALESCE(tax_amount, 0) ELSE 0 END
    + COALESCE(shipping_receiving_amount, 0)
    + COALESCE(payment_fee, 0)
  );

UPDATE ledger
SET paid = false
WHERE credit_debit = 'debit'
  AND paid = true
  AND (
    COALESCE(payment_amount, 0) + COALESCE(payment_fee, 0)
    + CASE WHEN write_off THEN COALESCE(write_off_amount, 0) ELSE 0 END
  ) < (
    COALESCE(customer_price, 0)
    + CASE WHEN wholesale_retail = 'wholesale' THEN COALESCE(tax_amount, 0) ELSE 0 END
    + COALESCE(shipping_receiving_amount, 0)
    + COALESCE(payment_fee, 0)
  );

NOTIFY pgrst, 'reload schema';
