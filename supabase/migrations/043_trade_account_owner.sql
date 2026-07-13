-- Who owns the trade partner account (Molly or Jess).
ALTER TABLE trade_partners
  ADD COLUMN IF NOT EXISTS account_owner TEXT;

ALTER TABLE trade_partners
  DROP CONSTRAINT IF EXISTS trade_partners_account_owner_check;

ALTER TABLE trade_partners
  ADD CONSTRAINT trade_partners_account_owner_check
  CHECK (account_owner IS NULL OR account_owner IN ('Molly', 'Jess'));

NOTIFY pgrst, 'reload schema';
