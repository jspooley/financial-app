-- Run this once in Supabase SQL Editor if you see missing-column errors.
-- Safe to re-run (uses IF NOT EXISTS / conditional renames).

-- Sand U Tax Paid
ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS sand_u_tax_paid BOOLEAN NOT NULL DEFAULT false;

-- Quantity
ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS quantity NUMERIC(12, 2) NOT NULL DEFAULT 1;

-- Rename cost -> designer_cost (if still named cost)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ledger' AND column_name = 'cost'
  ) THEN
    ALTER TABLE ledger RENAME COLUMN cost TO designer_cost;
  END IF;
END $$;

-- Rename discount_amount -> discount_percent on ledger (if still named discount_amount)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ledger' AND column_name = 'discount_amount'
  ) THEN
    ALTER TABLE ledger RENAME COLUMN discount_amount TO discount_percent;
  END IF;
END $$;

-- Customer price
ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS customer_price NUMERIC(12, 2) NOT NULL DEFAULT 0;

-- Refresh Supabase API schema cache
NOTIFY pgrst, 'reload schema';
