-- Explanation required when accepting a payment variance (max 250 chars).
ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS variance_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE ledger
  DROP CONSTRAINT IF EXISTS ledger_variance_notes_length;

ALTER TABLE ledger
  ADD CONSTRAINT ledger_variance_notes_length
  CHECK (char_length(variance_notes) <= 250);

NOTIFY pgrst, 'reload schema';
