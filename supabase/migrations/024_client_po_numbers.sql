-- PO numbers belong to clients and are created when the client is set up.
-- Ledger and invoicing reference these POs.

CREATE TABLE IF NOT EXISTS client_po_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  po_number TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, po_number)
);

CREATE INDEX IF NOT EXISTS idx_client_po_numbers_client_id ON client_po_numbers(client_id);

INSERT INTO client_po_numbers (client_id, po_number)
SELECT DISTINCT client_id, TRIM(po_number)
FROM (
  SELECT client_id, po_number FROM invoicing
  WHERE po_number IS NOT NULL AND TRIM(po_number) <> ''
  UNION
  SELECT client_id, po_number FROM ledger
  WHERE client_id IS NOT NULL AND po_number IS NOT NULL AND TRIM(po_number) <> ''
) existing
ON CONFLICT (client_id, po_number) DO NOTHING;

ALTER TABLE client_po_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can select client_po_numbers"
  ON client_po_numbers FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert client_po_numbers"
  ON client_po_numbers FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update client_po_numbers"
  ON client_po_numbers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete client_po_numbers"
  ON client_po_numbers FOR DELETE TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
