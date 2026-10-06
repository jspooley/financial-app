-- Pause an appointment without marking it lost.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS on_hold BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
