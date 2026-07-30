-- Personal-use purchases do not move business cash. Owner contributions that
-- cover S&U tax are entered manually on Cashflow as 300 Owner's Contribution.
-- Remove auto-created payment companions for personal-use (balance_sheet) parents
-- so those credits are not double-counted once the manual 300 rows are added.

DELETE FROM ledger AS companion
WHERE companion.companion_kind = 'payment'
  AND companion.source_ledger_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM ledger AS parent
    WHERE parent.id = companion.source_ledger_id
      AND COALESCE(parent.balance_sheet, false) = true
  );

-- Cost companions on personal-use parents are also non-cash for the business.
DELETE FROM ledger AS companion
WHERE companion.companion_kind IN ('shipping', 'fee', 'tax')
  AND companion.source_ledger_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM ledger AS parent
    WHERE parent.id = companion.source_ledger_id
      AND COALESCE(parent.balance_sheet, false) = true
  );

NOTIFY pgrst, 'reload schema';
