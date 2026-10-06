-- Date a proposal was marked sent, so follow-up is due 7 days later.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS proposal_sent_date DATE;

UPDATE public.appointments
SET proposal_sent_date = (updated_at AT TIME ZONE 'America/New_York')::date
WHERE proposal_sent = true
  AND proposal_sent_date IS NULL;

NOTIFY pgrst, 'reload schema';
