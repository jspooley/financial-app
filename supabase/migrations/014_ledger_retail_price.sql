-- Retail price on ledger entries; tax = retail_price × quantity × 0.06 for wholesale items.

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS retail_price NUMERIC(12, 2) NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
