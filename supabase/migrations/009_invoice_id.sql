-- Invoice ID support: multiple invoices per PO (PO-1, PO-2, ...)
-- Run in Supabase SQL Editor.

-- Ledger: invoice tracking
ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS invoiced BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS invoice_id TEXT;

-- Invoicing: unique invoice ID per bill
ALTER TABLE invoicing
  ADD COLUMN IF NOT EXISTS invoice_id TEXT;

ALTER TABLE invoicing
  ADD COLUMN IF NOT EXISTS invoice_sequence INTEGER;

-- Allow multiple invoices per client + PO (drop ledger FK first — it depends on the unique index)
ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_invoicing_fk;

ALTER TABLE invoicing DROP CONSTRAINT IF EXISTS invoicing_client_id_po_number_key;

UPDATE invoicing
SET invoice_sequence = 1, invoice_id = po_number || '-1'
WHERE invoice_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoicing_invoice_id ON invoicing(invoice_id);
CREATE INDEX IF NOT EXISTS idx_ledger_invoice_id ON ledger(invoice_id);
CREATE INDEX IF NOT EXISTS idx_ledger_invoiced ON ledger(invoiced);

NOTIFY pgrst, 'reload schema';
