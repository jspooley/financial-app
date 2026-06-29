ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_client_id ON appointments(client_id);

NOTIFY pgrst, 'reload schema';
