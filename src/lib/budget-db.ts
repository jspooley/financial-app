export const BUDGET_DB_SETUP_SQL = `CREATE TABLE budget_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room TEXT NOT NULL,
  item_description VARCHAR(30) NOT NULL,
  include_in_budget BOOLEAN NOT NULL DEFAULT false,
  quantity INTEGER NOT NULL DEFAULT 0,
  low_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  medium_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  high_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT budget_items_amounts_non_negative CHECK (
    low_amount >= 0 AND medium_amount >= 0 AND high_amount >= 0
  ),
  CONSTRAINT budget_items_quantity_non_negative CHECK (quantity >= 0)
);

CREATE INDEX idx_budget_items_room ON budget_items(room);

CREATE TRIGGER budget_items_updated_at BEFORE UPDATE ON budget_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can select budget_items"
  ON budget_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert budget_items"
  ON budget_items FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update budget_items"
  ON budget_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete budget_items"
  ON budget_items FOR DELETE TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';`;
