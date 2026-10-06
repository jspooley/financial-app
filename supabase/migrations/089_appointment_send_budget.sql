-- Flag an appointment that still needs a budget sent.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS send_budget BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
