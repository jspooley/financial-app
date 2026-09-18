-- Delivery is billed on the goods line like shipping/receiving and posts to its
-- own 203 commissions and fees companion. origin_ledger_id links a subsequent
-- charge line (uninvoiced shipping/receiving/delivery/card fee) back to the
-- paid merchandise row so the original invoice total stays locked.

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS delivery_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS origin_ledger_id UUID REFERENCES ledger(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_origin_ledger_id
  ON ledger(origin_ledger_id)
  WHERE origin_ledger_id IS NOT NULL;

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_origin_not_companion;
ALTER TABLE ledger
  ADD CONSTRAINT ledger_origin_not_companion
  CHECK (origin_ledger_id IS NULL OR source_ledger_id IS NULL);

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
      'delivery',
      'fee',
      'transfer',
      'card_reimburse'
    )
  );

NOTIFY pgrst, 'reload schema';
