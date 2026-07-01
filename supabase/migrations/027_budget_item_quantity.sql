ALTER TABLE budget_items
  ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 0;

ALTER TABLE budget_items DROP CONSTRAINT IF EXISTS budget_items_quantity_non_negative;
ALTER TABLE budget_items
  ADD CONSTRAINT budget_items_quantity_non_negative CHECK (quantity >= 0);

NOTIFY pgrst, 'reload schema';
