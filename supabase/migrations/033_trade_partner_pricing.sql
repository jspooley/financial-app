ALTER TABLE trade_partners
  ADD COLUMN IF NOT EXISTS retail_price NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE trade_partners
  ADD COLUMN IF NOT EXISTS designer_cost NUMERIC(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN trade_partners.retail_price IS 'Sample retail price used to derive trade discount %';
COMMENT ON COLUMN trade_partners.designer_cost IS 'Sample designer cost used to derive trade discount %';

NOTIFY pgrst, 'reload schema';
