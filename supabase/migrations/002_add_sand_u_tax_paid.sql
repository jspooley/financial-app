-- Add Sand U Tax Paid flag to ledger entries
ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS sand_u_tax_paid BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ledger_sand_u_tax_paid ON ledger(sand_u_tax_paid);
