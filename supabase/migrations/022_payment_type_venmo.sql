-- Payment types: add Venmo (CC already allowed).
-- Venmo fee (2.3%) and CC fee (2.6%) are calculated in the app.

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_payment_type_check;

ALTER TABLE ledger
  ADD CONSTRAINT ledger_payment_type_check
  CHECK (payment_type IS NULL OR payment_type IN ('Cash', 'Check', 'CC', 'Venmo', 'Other'));

NOTIFY pgrst, 'reload schema';
