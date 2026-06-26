-- Run this once in Supabase SQL Editor to fix missing ledger columns.
-- Safe to re-run.

-- Quantity
ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS quantity NUMERIC(12, 2) NOT NULL DEFAULT 1;

-- Rename cost -> designer_cost
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ledger' AND column_name = 'cost'
  ) THEN
    ALTER TABLE ledger RENAME COLUMN cost TO designer_cost;
  END IF;
END $$;

-- Rename discount_amount -> discount_percent on ledger
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ledger' AND column_name = 'discount_amount'
  ) THEN
    ALTER TABLE ledger RENAME COLUMN discount_amount TO discount_percent;
  END IF;
END $$;

-- Customer price (fixes "customer_price column not found" error)
ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS customer_price NUMERIC(12, 2) NOT NULL DEFAULT 0;

-- Invoiced flag
ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS invoiced BOOLEAN NOT NULL DEFAULT false;

-- Sales and Use Tax Paid (rename from sand_u_tax_paid if needed)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ledger' AND column_name = 'sand_u_tax_paid'
  ) THEN
    ALTER TABLE ledger RENAME COLUMN sand_u_tax_paid TO sales_and_use_tax_paid;
  END IF;
END $$;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS sales_and_use_tax_paid BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ledger_invoiced ON ledger(invoiced);
CREATE INDEX IF NOT EXISTS idx_ledger_sales_and_use_tax_paid ON ledger(sales_and_use_tax_paid);

NOTIFY pgrst, 'reload schema';
