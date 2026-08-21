-- Exclusive edit locks so only one signed-in user can change a record at a time.
-- UI acquires a lock when Edit opens. Expired locks are cleared automatically.

CREATE TABLE IF NOT EXISTS public.record_locks (
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  locked_by UUID NOT NULL,
  locked_by_email TEXT NOT NULL DEFAULT '',
  locked_by_name TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (table_name, record_id)
);

CREATE INDEX IF NOT EXISTS idx_record_locks_expires_at ON public.record_locks(expires_at);
CREATE INDEX IF NOT EXISTS idx_record_locks_locked_by ON public.record_locks(locked_by);

ALTER TABLE public.record_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can select record_locks" ON public.record_locks;
CREATE POLICY "Authenticated users can select record_locks"
  ON public.record_locks FOR SELECT TO authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.record_locks FROM authenticated;
GRANT SELECT ON public.record_locks TO authenticated;

CREATE OR REPLACE FUNCTION public.record_lock_holder_name(p_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  local text := lower(split_part(coalesce(p_email, ''), '@', 1));
BEGIN
  IF local LIKE '%jess%' THEN
    RETURN 'Jess';
  ELSIF local LIKE '%molly%' THEN
    RETURN 'Molly';
  ELSIF local <> '' THEN
    RETURN initcap(replace(local, '.', ' '));
  ELSE
    RETURN 'Another user';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.acquire_record_locks(
  p_locks jsonb,
  p_ttl_seconds integer DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  email text := '';
  holder text;
  lock_item jsonb;
  table_n text;
  rec_id text;
  existing public.record_locks%ROWTYPE;
  ttl integer := GREATEST(coalesce(p_ttl_seconds, 90), 30);
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not signed in');
  END IF;

  IF p_locks IS NULL OR jsonb_typeof(p_locks) <> 'array' OR jsonb_array_length(p_locks) = 0 THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  SELECT u.email INTO email FROM auth.users u WHERE u.id = uid;
  holder := public.record_lock_holder_name(email);

  LOCK TABLE public.record_locks IN EXCLUSIVE MODE;

  DELETE FROM public.record_locks WHERE expires_at <= now();

  FOR lock_item IN SELECT value FROM jsonb_array_elements(p_locks)
  LOOP
    table_n := lock_item->>'table_name';
    rec_id := lock_item->>'record_id';
    IF table_n IS NULL OR rec_id IS NULL OR table_n = '' OR rec_id = '' THEN
      CONTINUE;
    END IF;

    SELECT * INTO existing
    FROM public.record_locks
    WHERE table_name = table_n AND record_id = rec_id;

    IF FOUND AND existing.locked_by IS DISTINCT FROM uid THEN
      RETURN jsonb_build_object(
        'ok', false,
        'holder_name', existing.locked_by_name
      );
    END IF;
  END LOOP;

  FOR lock_item IN SELECT value FROM jsonb_array_elements(p_locks)
  LOOP
    table_n := lock_item->>'table_name';
    rec_id := lock_item->>'record_id';
    IF table_n IS NULL OR rec_id IS NULL OR table_n = '' OR rec_id = '' THEN
      CONTINUE;
    END IF;

    INSERT INTO public.record_locks (
      table_name,
      record_id,
      locked_by,
      locked_by_email,
      locked_by_name,
      locked_at,
      expires_at
    )
    VALUES (
      table_n,
      rec_id,
      uid,
      coalesce(email, ''),
      holder,
      now(),
      now() + make_interval(secs => ttl)
    )
    ON CONFLICT (table_name, record_id) DO UPDATE
      SET locked_by = uid,
          locked_by_email = excluded.locked_by_email,
          locked_by_name = excluded.locked_by_name,
          locked_at = now(),
          expires_at = excluded.expires_at;
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_record_locks(p_locks jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not signed in');
  END IF;

  IF p_locks IS NULL OR jsonb_typeof(p_locks) <> 'array' OR jsonb_array_length(p_locks) = 0 THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  DELETE FROM public.record_locks rl
  WHERE rl.locked_by = uid
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_locks) AS lock_item
      WHERE rl.table_name = lock_item.value->>'table_name'
        AND rl.record_id = lock_item.value->>'record_id'
    );

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_record_locks(
  p_locks jsonb,
  p_ttl_seconds integer DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  ttl integer := GREATEST(coalesce(p_ttl_seconds, 90), 30);
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not signed in');
  END IF;

  IF p_locks IS NULL OR jsonb_typeof(p_locks) <> 'array' OR jsonb_array_length(p_locks) = 0 THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  UPDATE public.record_locks rl
  SET expires_at = now() + make_interval(secs => ttl)
  WHERE rl.locked_by = uid
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_locks) AS lock_item
      WHERE rl.table_name = lock_item.value->>'table_name'
        AND rl.record_id = lock_item.value->>'record_id'
    );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_record_locks(jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_record_locks(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.heartbeat_record_locks(jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_record_locks(jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_record_locks(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_record_locks(jsonb, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_foreign_record_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec_id text;
  holder text;
  tbl text := TG_TABLE_NAME;
BEGIN
  IF tbl = 'app_documentation' THEN
    rec_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.section_key ELSE NEW.section_key END;
  ELSE
    rec_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  END IF;

  SELECT locked_by_name INTO holder
  FROM public.record_locks
  WHERE expires_at > now()
    AND locked_by IS DISTINCT FROM auth.uid()
    AND (
      (table_name = tbl AND record_id = rec_id)
      OR (tbl = 'app_documentation' AND table_name = 'app_documentation' AND record_id = '__all__')
    )
  LIMIT 1;

  IF holder IS NOT NULL THEN
    RAISE EXCEPTION 'This item is being edited by %', holder
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_lock_clients ON public.clients;
CREATE TRIGGER record_lock_clients
  BEFORE UPDATE OR DELETE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.prevent_foreign_record_lock();

DROP TRIGGER IF EXISTS record_lock_client_po_numbers ON public.client_po_numbers;
CREATE TRIGGER record_lock_client_po_numbers
  BEFORE UPDATE OR DELETE ON public.client_po_numbers
  FOR EACH ROW EXECUTE FUNCTION public.prevent_foreign_record_lock();

DROP TRIGGER IF EXISTS record_lock_trade_partners ON public.trade_partners;
CREATE TRIGGER record_lock_trade_partners
  BEFORE UPDATE OR DELETE ON public.trade_partners
  FOR EACH ROW EXECUTE FUNCTION public.prevent_foreign_record_lock();

DROP TRIGGER IF EXISTS record_lock_appointments ON public.appointments;
CREATE TRIGGER record_lock_appointments
  BEFORE UPDATE OR DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_foreign_record_lock();

DROP TRIGGER IF EXISTS record_lock_invoicing ON public.invoicing;
CREATE TRIGGER record_lock_invoicing
  BEFORE UPDATE OR DELETE ON public.invoicing
  FOR EACH ROW EXECUTE FUNCTION public.prevent_foreign_record_lock();

DROP TRIGGER IF EXISTS record_lock_ledger ON public.ledger;
CREATE TRIGGER record_lock_ledger
  BEFORE UPDATE OR DELETE ON public.ledger
  FOR EACH ROW EXECUTE FUNCTION public.prevent_foreign_record_lock();

DROP TRIGGER IF EXISTS record_lock_budget_items ON public.budget_items;
CREATE TRIGGER record_lock_budget_items
  BEFORE UPDATE OR DELETE ON public.budget_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_foreign_record_lock();

DROP TRIGGER IF EXISTS record_lock_chart_of_accounts ON public.chart_of_accounts;
CREATE TRIGGER record_lock_chart_of_accounts
  BEFORE UPDATE OR DELETE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_foreign_record_lock();

DROP TRIGGER IF EXISTS record_lock_app_documentation ON public.app_documentation;
CREATE TRIGGER record_lock_app_documentation
  BEFORE UPDATE OR DELETE ON public.app_documentation
  FOR EACH ROW EXECUTE FUNCTION public.prevent_foreign_record_lock();

DROP TRIGGER IF EXISTS record_lock_cashflow ON public.cashflow;
CREATE TRIGGER record_lock_cashflow
  BEFORE UPDATE OR DELETE ON public.cashflow
  FOR EACH ROW EXECUTE FUNCTION public.prevent_foreign_record_lock();

NOTIFY pgrst, 'reload schema';
