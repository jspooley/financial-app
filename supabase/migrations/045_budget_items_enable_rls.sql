-- Ensure RLS is enabled on budget_items (fixes live DB drift where RLS was off).
ALTER TABLE public.budget_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can select budget_items" ON public.budget_items;
CREATE POLICY "Authenticated users can select budget_items"
  ON public.budget_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert budget_items" ON public.budget_items;
CREATE POLICY "Authenticated users can insert budget_items"
  ON public.budget_items FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update budget_items" ON public.budget_items;
CREATE POLICY "Authenticated users can update budget_items"
  ON public.budget_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete budget_items" ON public.budget_items;
CREATE POLICY "Authenticated users can delete budget_items"
  ON public.budget_items FOR DELETE TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
