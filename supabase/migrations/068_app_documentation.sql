-- Shared app documentation notes (one row per app section).
CREATE TABLE IF NOT EXISTS public.app_documentation (
  section_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_documentation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can select app_documentation" ON public.app_documentation;
CREATE POLICY "Authenticated users can select app_documentation"
  ON public.app_documentation FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert app_documentation" ON public.app_documentation;
CREATE POLICY "Authenticated users can insert app_documentation"
  ON public.app_documentation FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update app_documentation" ON public.app_documentation;
CREATE POLICY "Authenticated users can update app_documentation"
  ON public.app_documentation FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete app_documentation" ON public.app_documentation;
CREATE POLICY "Authenticated users can delete app_documentation"
  ON public.app_documentation FOR DELETE TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
