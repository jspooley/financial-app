-- Split cashflow accounts by Jess / Molly.
UPDATE cashflow
SET account = 'Checking - Jess'
WHERE account = 'Checking';

UPDATE cashflow
SET account = 'Credit Card - Jess'
WHERE account = 'Credit Card';

ALTER TABLE cashflow DROP CONSTRAINT IF EXISTS cashflow_account_check;

ALTER TABLE cashflow
  ADD CONSTRAINT cashflow_account_check
  CHECK (account IN (
    'Checking - Jess',
    'Checking - Molly',
    'Credit Card - Jess',
    'Credit Card - Molly'
  ));

NOTIFY pgrst, 'reload schema';
