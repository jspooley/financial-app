-- User-identified personal-card role so moved checking rows are not all
-- treated as charges. Matching only uses rows marked charge.

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS personal_card_role TEXT;

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_personal_card_role_check;
ALTER TABLE ledger
  ADD CONSTRAINT ledger_personal_card_role_check
  CHECK (
    personal_card_role IS NULL
    OR personal_card_role IN ('charge', 'reimbursement')
  );

NOTIFY pgrst, 'reload schema';
