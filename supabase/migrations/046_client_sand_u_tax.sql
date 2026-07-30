-- Sales & Use Tax rate per client (4 decimal places).
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS sand_u_tax NUMERIC(8, 4) NOT NULL DEFAULT 0;

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_sand_u_tax_non_negative;
ALTER TABLE clients
  ADD CONSTRAINT clients_sand_u_tax_non_negative CHECK (sand_u_tax >= 0);

NOTIFY pgrst, 'reload schema';
