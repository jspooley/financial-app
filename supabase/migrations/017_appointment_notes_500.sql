ALTER TABLE appointments
  ALTER COLUMN notes TYPE VARCHAR(500);

NOTIFY pgrst, 'reload schema';
