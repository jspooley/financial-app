-- Personal-use clients: ledger entries are marked balance_sheet.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS personal_use BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_clients_personal_use ON clients(personal_use);

NOTIFY pgrst, 'reload schema';
