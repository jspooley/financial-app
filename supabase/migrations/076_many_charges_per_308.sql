-- One checking 308 can reimburse several personal-card charges.
-- 072 created a unique index that allowed only one charge per 308.

DROP INDEX IF EXISTS ledger_reimbursed_by_ledger_id_uidx;

CREATE INDEX IF NOT EXISTS idx_ledger_reimbursed_by_ledger_id
  ON ledger (reimbursed_by_ledger_id)
  WHERE reimbursed_by_ledger_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
