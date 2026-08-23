-- Separate why money leaves checking:
--   302 = owner's draw (transfer profit)
--   306 = pay back a business loan
--   308 = reimburse a personal credit card
-- 303/304 remain partner-to-partner transfers.

UPDATE chart_of_accounts
SET category = '302 Owner''s Draws (transfer profit)'
WHERE category = '302 Transfers between accounts (paying a credit card bill)';

INSERT INTO chart_of_accounts (category)
SELECT '306 Pay back business loan'
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE left(trim(category), 3) = '306'
);

INSERT INTO chart_of_accounts (category)
SELECT '308 Reimburse personal credit card'
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE left(trim(category), 3) = '308'
);

NOTIFY pgrst, 'reload schema';
