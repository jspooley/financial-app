-- Rename PO MJ-CK-2604-1 → MJ-CK-20264 and invoice MJ-CK-2604-1-1 → MJ-CK-20264-1
-- Chandler Klevana. Run once in Supabase SQL Editor.

BEGIN;

DO $$
DECLARE
  v_client_id UUID;
BEGIN
  SELECT client_id INTO v_client_id
  FROM invoicing
  WHERE invoice_id = 'MJ-CK-2604-1-1';

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Invoice MJ-CK-2604-1-1 was not found in invoicing.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM invoicing WHERE invoice_id = 'MJ-CK-20264-1'
  ) THEN
    RAISE EXCEPTION 'Invoice MJ-CK-20264-1 already exists. Resolve that conflict before renaming.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM invoicing
    WHERE client_id = v_client_id
      AND TRIM(po_number) = 'MJ-CK-20264'
      AND invoice_id <> 'MJ-CK-2604-1-1'
  ) THEN
    RAISE EXCEPTION 'Another invoice already uses PO MJ-CK-20264 for this client.';
  END IF;
END $$;

UPDATE ledger
SET invoice_id = 'MJ-CK-20264-1'
WHERE invoice_id = 'MJ-CK-2604-1-1';

UPDATE ledger
SET po_number = 'MJ-CK-20264'
WHERE client_id = (SELECT client_id FROM invoicing WHERE invoice_id = 'MJ-CK-2604-1-1')
  AND TRIM(po_number) = 'MJ-CK-2604-1';

DO $$
DECLARE
  v_client_id UUID;
BEGIN
  SELECT client_id INTO v_client_id
  FROM invoicing
  WHERE invoice_id = 'MJ-CK-2604-1-1';

  IF EXISTS (
    SELECT 1 FROM client_po_numbers
    WHERE client_id = v_client_id AND TRIM(po_number) = 'MJ-CK-20264'
  ) THEN
    DELETE FROM client_po_numbers
    WHERE client_id = v_client_id AND TRIM(po_number) = 'MJ-CK-2604-1';
  ELSE
    UPDATE client_po_numbers
    SET po_number = 'MJ-CK-20264'
    WHERE client_id = v_client_id AND TRIM(po_number) = 'MJ-CK-2604-1';
  END IF;
END $$;

UPDATE invoicing
SET
  po_number = 'MJ-CK-20264',
  invoice_id = 'MJ-CK-20264-1',
  invoice_sequence = 1
WHERE invoice_id = 'MJ-CK-2604-1-1';

COMMIT;

NOTIFY pgrst, 'reload schema';
