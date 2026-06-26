-- discount_amount on trade_partners stores a percentage (0-100), not dollars.
-- No column rename required; the app reads/writes discount_amount as percent.

COMMENT ON COLUMN trade_partners.discount_amount IS 'Trade discount percentage (0-100)';
