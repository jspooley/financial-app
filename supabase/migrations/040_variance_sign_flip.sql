-- Flip variance sign convention:
-- positive = overpayment, negative = underpayment
-- (previously the opposite).

UPDATE ledger
SET variance_amount = -variance_amount
WHERE COALESCE(variance_amount, 0) <> 0;
