-- Cashflow register: department/expense tracking with checking or credit card.
CREATE TABLE cashflow (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  department TEXT NOT NULL
    CHECK (department IN ('Interior Design', 'Internal', 'Paint')),
  expense_type TEXT NOT NULL
    CHECK (expense_type IN (
      'admin',
      'travel',
      'meals',
      'advertising',
      'office expense',
      'supplies',
      'tax & License',
      'fees',
      'subscriptions'
    )),
  description TEXT,
  debit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  credit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  account TEXT NOT NULL
    CHECK (account IN ('Checking', 'Credit Card')),
  designer TEXT NOT NULL
    CHECK (designer IN ('Jess', 'Molly')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cashflow_amounts_non_negative CHECK (
    debit_amount >= 0 AND credit_amount >= 0
  )
);

CREATE INDEX idx_cashflow_entry_date ON cashflow(entry_date DESC);
CREATE INDEX idx_cashflow_department ON cashflow(department);
CREATE INDEX idx_cashflow_account ON cashflow(account);

CREATE TRIGGER cashflow_updated_at BEFORE UPDATE ON cashflow
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE cashflow ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can select cashflow"
  ON cashflow FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert cashflow"
  ON cashflow FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update cashflow"
  ON cashflow FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete cashflow"
  ON cashflow FOR DELETE TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
