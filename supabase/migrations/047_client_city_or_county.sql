-- City or county for client sales-tax lookup.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS city_or_county TEXT;

NOTIFY pgrst, 'reload schema';
