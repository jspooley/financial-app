ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS proposal_sent BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
