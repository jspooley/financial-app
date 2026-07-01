-- Add Dining Room budget items (safe to re-run: skips rows that already exist).

INSERT INTO budget_items (
  room,
  item_description,
  include_in_budget,
  quantity,
  low_amount,
  medium_amount,
  high_amount
)
SELECT *
FROM (
  VALUES
    ('Dining Room', 'Dining Room Table', false, 0, 2799.20, 2240.00, 12000.00),
    ('Dining Room', 'Chairs for Table (per chair)', false, 0, 415.20, 560.00, 1600.00),
    ('Dining Room', 'Credenza', false, 0, 1679.20, 2240.00, 4800.00),
    ('Dining Room', 'Lamps', false, 0, 144.00, 292.00, 640.00),
    ('Dining Room', 'Rug', false, 0, 953.60, 1600.00, 2972.80),
    ('Dining Room', 'Paint/Wallpaper', false, 0, 300.00, 4800.00, 12000.00),
    ('Dining Room', 'Chandelier', false, 0, 958.40, 960.00, 4000.00)
) AS seed (room, item_description, include_in_budget, quantity, low_amount, medium_amount, high_amount)
WHERE NOT EXISTS (
  SELECT 1
  FROM budget_items existing
  WHERE existing.room = seed.room
    AND existing.item_description = seed.item_description
);

NOTIFY pgrst, 'reload schema';
