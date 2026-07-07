-- Saved budget planner state (sliders, qty, room/item toggles) per client PO.
ALTER TABLE client_po_numbers
  ADD COLUMN IF NOT EXISTS budget_plan JSONB,
  ADD COLUMN IF NOT EXISTS budget_pdf_path TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('client-budgets', 'client-budgets', false, 10485760)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users can read client budgets" ON storage.objects;
CREATE POLICY "Authenticated users can read client budgets"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'client-budgets');

DROP POLICY IF EXISTS "Authenticated users can upload client budgets" ON storage.objects;
CREATE POLICY "Authenticated users can upload client budgets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-budgets');

DROP POLICY IF EXISTS "Authenticated users can update client budgets" ON storage.objects;
CREATE POLICY "Authenticated users can update client budgets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'client-budgets');

DROP POLICY IF EXISTS "Authenticated users can delete client budgets" ON storage.objects;
CREATE POLICY "Authenticated users can delete client budgets"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'client-budgets');

NOTIFY pgrst, 'reload schema';
