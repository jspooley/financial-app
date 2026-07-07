export const CLIENT_BUDGET_SETUP_SQL = `ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS budget NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE client_po_numbers
  ADD COLUMN IF NOT EXISTS budget NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE client_po_numbers
  ADD COLUMN IF NOT EXISTS budget_plan JSONB;

ALTER TABLE client_po_numbers
  ADD COLUMN IF NOT EXISTS budget_pdf_path TEXT;

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_budget_non_negative;
ALTER TABLE clients
  ADD CONSTRAINT clients_budget_non_negative CHECK (budget >= 0);

ALTER TABLE client_po_numbers DROP CONSTRAINT IF EXISTS client_po_numbers_budget_non_negative;
ALTER TABLE client_po_numbers
  ADD CONSTRAINT client_po_numbers_budget_non_negative CHECK (budget >= 0);

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('client-budgets', 'client-budgets', false, 10485760)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';`;
