-- Rename accepted shortfall → signed variance (underpayment > 0, overpayment < 0).
ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS variance_accepted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS variance_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ledger'
      AND column_name = 'shortfall_accepted'
  ) THEN
    UPDATE ledger
    SET
      variance_accepted = shortfall_accepted,
      variance_amount = shortfall_amount
    WHERE shortfall_accepted = true
       OR shortfall_amount <> 0;
  END IF;
END $$;

ALTER TABLE ledger DROP COLUMN IF EXISTS shortfall_accepted;
ALTER TABLE ledger DROP COLUMN IF EXISTS shortfall_amount;

DROP INDEX IF EXISTS idx_ledger_shortfall_accepted;
CREATE INDEX IF NOT EXISTS idx_ledger_variance_accepted ON ledger(variance_accepted);

NOTIFY pgrst, 'reload schema';
