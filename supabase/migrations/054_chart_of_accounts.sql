-- Chart of accounts categories for cashflow / P&L classification.
CREATE TABLE chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chart_of_accounts_category ON chart_of_accounts(category);

CREATE TRIGGER chart_of_accounts_updated_at BEFORE UPDATE ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can select chart_of_accounts"
  ON chart_of_accounts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert chart_of_accounts"
  ON chart_of_accounts FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update chart_of_accounts"
  ON chart_of_accounts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete chart_of_accounts"
  ON chart_of_accounts FOR DELETE TO authenticated USING (true);

INSERT INTO chart_of_accounts (category) VALUES
  ('100 Sales Income'),
  ('101 COGS'),
  ('200 advertising'),
  ('201 car and truck expenses'),
  ('203 commissions and fees'),
  ('204 contract labor'),
  ('205 depletion'),
  ('206 depreciation'),
  ('207 Insurance'),
  ('208 Interest'),
  ('209 Legal & prof Svcs'),
  ('210 Office Expense'),
  ('211 Repairs & Maintenance'),
  ('212 Supplies'),
  ('213 Paint Supplies'),
  ('214 Taxes and licenses'),
  ('215 Travel'),
  ('216 Deductible meals'),
  ('300 Owner''s Contribution (not consider income)'),
  ('301 Owner''s Draws (not considered expense)'),
  ('302 Transfers between accounts (paying a credit card bill)');

NOTIFY pgrst, 'reload schema';
