-- Service lines now use Discount % off retail (same as wholesale), not markup
-- on designer cost. retail_price already stores the sell price from the old
-- markup model, so clear former markup values so totals stay retail × qty.
-- Designer cost may be $0 for services.

UPDATE ledger
SET
  discount_percent = 0,
  customer_price = ROUND(COALESCE(retail_price, 0) * COALESCE(quantity, 1), 2)
WHERE wholesale_retail = 'service'
  AND (
    COALESCE(discount_percent, 0) <> 0
    OR COALESCE(customer_price, 0) IS DISTINCT FROM
      ROUND(COALESCE(retail_price, 0) * COALESCE(quantity, 1), 2)
  );

NOTIFY pgrst, 'reload schema';
