-- Stamp who created each ledger row so Cashflow can show Entered by / date.

ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS created_by UUID;

ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS created_by_name TEXT;

CREATE INDEX IF NOT EXISTS idx_ledger_created_by ON public.ledger(created_by);

CREATE OR REPLACE FUNCTION public.stamp_ledger_created_by()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  email text := '';
BEGIN
  IF uid IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.created_by := uid;
  SELECT u.email INTO email FROM auth.users u WHERE u.id = uid;
  NEW.created_by_name := public.record_lock_holder_name(email);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ledger_stamp_created_by ON public.ledger;
CREATE TRIGGER ledger_stamp_created_by
  BEFORE INSERT ON public.ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_ledger_created_by();

NOTIFY pgrst, 'reload schema';
