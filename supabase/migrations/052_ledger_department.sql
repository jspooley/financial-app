-- Add department to ledger; backfill existing rows as Interior Design.
ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS department TEXT;

UPDATE ledger
SET department = 'Interior Design'
WHERE department IS NULL;

ALTER TABLE ledger
  ALTER COLUMN department SET DEFAULT 'Interior Design';

ALTER TABLE ledger
  ALTER COLUMN department SET NOT NULL;

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_department_check;
ALTER TABLE ledger
  ADD CONSTRAINT ledger_department_check
  CHECK (department IN ('Interior Design', 'Internal', 'Paint'));

CREATE INDEX IF NOT EXISTS idx_ledger_department ON ledger(department);

NOTIFY pgrst, 'reload schema';
