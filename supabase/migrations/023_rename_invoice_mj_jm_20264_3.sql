-- Rename invoice MJ-JM-20264-3 → MJ-JM-20264-1
-- Run once in Supabase SQL Editor.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM invoicing WHERE invoice_id = 'MJ-JM-20264-3'
  ) THEN
    RAISE EXCEPTION 'Invoice MJ-JM-20264-3 was not found in invoicing.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM invoicing WHERE invoice_id = 'MJ-JM-20264-1'
  ) THEN
    RAISE EXCEPTION 'Invoice MJ-JM-20264-1 already exists. Resolve that conflict before renaming.';
  END IF;
END $$;

UPDATE ledger
SET invoice_id = 'MJ-JM-20264-1'
WHERE invoice_id = 'MJ-JM-20264-3';

UPDATE invoicing
SET
  invoice_id = 'MJ-JM-20264-1',
  invoice_sequence = 1
WHERE invoice_id = 'MJ-JM-20264-3';

COMMIT;

NOTIFY pgrst, 'reload schema';
