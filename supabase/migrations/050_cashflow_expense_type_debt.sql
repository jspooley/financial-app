-- Allow Issuing Debt and Repaying Debt as cashflow expense types.
ALTER TABLE cashflow DROP CONSTRAINT IF EXISTS cashflow_expense_type_check;

ALTER TABLE cashflow
  ADD CONSTRAINT cashflow_expense_type_check
  CHECK (expense_type IN (
    'admin',
    'travel',
    'meals',
    'advertising',
    'office expense',
    'supplies',
    'tax & License',
    'fees',
    'subscriptions',
    'COGS',
    'Issuing Debt',
    'Repaying Debt'
  ));

NOTIFY pgrst, 'reload schema';
