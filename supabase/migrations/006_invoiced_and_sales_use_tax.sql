-- Add Invoices flag and rename Sand U Tax Paid column
ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS invoiced BOOLEAN NOT NULL DEFAULT false;

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

DROP INDEX IF EXISTS idx_ledger_sand_u_tax_paid;
CREATE INDEX IF NOT EXISTS idx_ledger_sales_and_use_tax_paid
  ON ledger(sales_and_use_tax_paid);

CREATE INDEX IF NOT EXISTS idx_ledger_invoiced ON ledger(invoiced);

NOTIFY pgrst, 'reload schema';
