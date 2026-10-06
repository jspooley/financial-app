-- Flag an appointment that still needs a proposal sent.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS send_proposal BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
