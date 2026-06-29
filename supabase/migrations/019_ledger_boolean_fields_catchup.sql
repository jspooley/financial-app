-- Run once in Supabase SQL Editor if ledger save fails with missing column errors.
-- Safe to re-run. Keeps sand_u_tax_paid as the column name (no rename).

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS sand_u_tax_paid BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ledger_sand_u_tax_paid ON ledger(sand_u_tax_paid);

NOTIFY pgrst, 'reload schema';
