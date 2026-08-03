-- DO NOT RUN DELETES FROM THIS MIGRATION.
--
-- An earlier version of this file deleted payment (and cost) companions linked
-- to personal-use (balance_sheet) parents. That destroyed real payment rows the
-- business had to re-enter by hand.
--
-- Personal-use handling belongs in application logic (do not auto-create new
-- Sales Income companions for balance_sheet parents). Existing companions must
-- be left in place.
--
-- This file is intentionally a no-op so it is never destructive if applied.

SELECT 1;

NOTIFY pgrst, 'reload schema';
