-- Ledger pricing updates: quantity, designer cost, discount %, customer price
-- Run in Supabase SQL Editor.

ALTER TABLE ledger ADD COLUMN IF NOT EXISTS quantity NUMERIC(12, 2) NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ledger' AND column_name = 'cost'
  ) THEN
    ALTER TABLE ledger RENAME COLUMN cost TO designer_cost;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ledger' AND column_name = 'discount_amount'
  ) THEN
    ALTER TABLE ledger RENAME COLUMN discount_amount TO discount_percent;
  END IF;
END $$;

ALTER TABLE ledger ADD COLUMN IF NOT EXISTS customer_price NUMERIC(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN ledger.designer_cost IS 'Per-unit designer cost';
COMMENT ON COLUMN ledger.quantity IS 'Item quantity';
COMMENT ON COLUMN ledger.discount_percent IS 'Ledger discount percentage (defaults to half of trade partner rate)';
COMMENT ON COLUMN ledger.customer_price IS 'Calculated customer price saved on entry';
