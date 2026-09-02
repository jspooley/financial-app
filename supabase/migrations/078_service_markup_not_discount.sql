-- Service lines use markup % off designer cost (same as no-trade retail), not discount
-- off retail. retail_price stores the sell price; clear former discount values so totals
-- stay retail × qty. Designer cost may be $0 for services.

UPDATE ledger
SET
  discount_percent = CASE
    WHEN COALESCE(designer_cost, 0) > 0
      AND COALESCE(retail_price, 0) > COALESCE(designer_cost, 0)
    THEN ROUND(
      ((COALESCE(retail_price, 0) - COALESCE(designer_cost, 0))
        / COALESCE(designer_cost, 0)) * 100,
      2
    )
    ELSE 0
  END,
  customer_price = ROUND(COALESCE(retail_price, 0) * COALESCE(quantity, 1), 2)
WHERE wholesale_retail = 'service'
  AND (
    COALESCE(discount_percent, 0) <> 0
    OR COALESCE(customer_price, 0) IS DISTINCT FROM
      ROUND(COALESCE(retail_price, 0) * COALESCE(quantity, 1), 2)
  );

NOTIFY pgrst, 'reload schema';
