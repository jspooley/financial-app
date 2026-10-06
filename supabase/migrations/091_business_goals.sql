-- Shared business goals for the P&L gauges. One row for the whole company.
CREATE TABLE IF NOT EXISTS public.business_goals (
  id TEXT PRIMARY KEY DEFAULT 'default',
  gross_profit_margin NUMERIC(7, 2),
  gross_profit NUMERIC(14, 2),
  net_profit NUMERIC(14, 2),
  net_profit_margin NUMERIC(7, 2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_goals_singleton CHECK (id = 'default')
);

INSERT INTO public.business_goals (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS business_goals_updated_at ON public.business_goals;
CREATE TRIGGER business_goals_updated_at
  BEFORE UPDATE ON public.business_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.business_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can select business_goals" ON public.business_goals;
CREATE POLICY "Authenticated users can select business_goals"
  ON public.business_goals FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert business_goals" ON public.business_goals;
CREATE POLICY "Authenticated users can insert business_goals"
  ON public.business_goals FOR INSERT TO authenticated WITH CHECK (id = 'default');

DROP POLICY IF EXISTS "Authenticated users can update business_goals" ON public.business_goals;
CREATE POLICY "Authenticated users can update business_goals"
  ON public.business_goals FOR UPDATE TO authenticated USING (true) WITH CHECK (id = 'default');

NOTIFY pgrst, 'reload schema';
