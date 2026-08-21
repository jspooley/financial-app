export const DOCUMENTATION_SECTIONS = [
  { key: "overview", title: "Overview" },
  { key: "appointments", title: "Appointments" },
  { key: "quoting", title: "Quoting Tool" },
  { key: "clients", title: "Clients" },
  { key: "goods-services", title: "Goods & Services" },
  { key: "invoicing", title: "Invoicing" },
  { key: "payments", title: "Payments" },
  { key: "trade-accounts", title: "Trade Accounts" },
  { key: "chart-of-accounts", title: "Chart of Accounts" },
  { key: "cashflow", title: "Cashflow" },
  { key: "bank-cashflow", title: "Bank vs Cashflow" },
  { key: "sales-use-tax", title: "Sales & Use Tax" },
  { key: "pl-report", title: "P&L Report" },
  { key: "true-up", title: "True Up Report" },
  { key: "reconciliation", title: "Reconciliation" },
  { key: "schedule-c", title: "Schedule C" },
] as const;

export type DocumentationSectionKey =
  (typeof DOCUMENTATION_SECTIONS)[number]["key"];

export type AppDocumentationRow = {
  section_key: string;
  title: string;
  body: string;
  updated_at: string;
};

export const APP_DOCUMENTATION_SETUP_SQL = `CREATE TABLE IF NOT EXISTS public.app_documentation (
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

NOTIFY pgrst, 'reload schema';`;

export function isDocumentationSchemaError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("app_documentation") ||
    lower.includes("schema cache") ||
    lower.includes("does not exist")
  );
}
