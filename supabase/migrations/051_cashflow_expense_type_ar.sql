-- Allow Accounts Receivable as a cashflow expense type.
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
    'Repaying Debt',
    'Accounts Receivable'
  ));

NOTIFY pgrst, 'reload schema';
