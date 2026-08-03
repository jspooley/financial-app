"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  APP_DOCUMENTATION_SETUP_SQL,
  DOCUMENTATION_SECTIONS,
  isDocumentationSchemaError,
  type AppDocumentationRow,
} from "@/lib/app-documentation";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";

type DraftMap = Record<string, string>;

function emptyDrafts(): DraftMap {
  const drafts: DraftMap = {};
  for (const section of DOCUMENTATION_SECTIONS) {
    drafts[section.key] = "";
  }
  return drafts;
}

export default function DocumentationPage() {
  const [drafts, setDrafts] = useState<DraftMap>(emptyDrafts);
  const [saved, setSaved] = useState<DraftMap>(emptyDrafts);
  const [updatedAtByKey, setUpdatedAtByKey] = useState<Record<string, string>>(
    {}
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  const dirty = useMemo(
    () =>
      DOCUMENTATION_SECTIONS.some(
        (section) => (drafts[section.key] ?? "") !== (saved[section.key] ?? "")
      ),
    [drafts, saved]
  );

  const loadDocumentation = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsSetup(false);
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("app_documentation")
      .select("section_key, title, body, updated_at");

    if (loadError) {
      if (isDocumentationSchemaError(loadError.message)) {
        setNeedsSetup(true);
      }
      setError(loadError.message);
      setDrafts(emptyDrafts());
      setSaved(emptyDrafts());
      setUpdatedAtByKey({});
      setLoading(false);
      return;
    }

    const nextDrafts = emptyDrafts();
    const nextUpdated: Record<string, string> = {};
    for (const row of (data ?? []) as AppDocumentationRow[]) {
      if (row.section_key in nextDrafts) {
        nextDrafts[row.section_key] = row.body ?? "";
        nextUpdated[row.section_key] = row.updated_at;
      }
    }
    setDrafts(nextDrafts);
    setSaved({ ...nextDrafts });
    setUpdatedAtByKey(nextUpdated);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadDocumentation();
  }, [loadDocumentation]);

  function updateDraft(key: string, value: string) {
    setDrafts((current) => ({ ...current, [key]: value }));
    setSuccess(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    setNeedsSetup(false);

    const supabase = createClient();
    const now = new Date().toISOString();
    const rows = DOCUMENTATION_SECTIONS.map((section) => ({
      section_key: section.key,
      title: section.title,
      body: drafts[section.key] ?? "",
      updated_at: now,
    }));

    const { error: saveError } = await supabase
      .from("app_documentation")
      .upsert(rows, { onConflict: "section_key" });

    if (saveError) {
      if (isDocumentationSchemaError(saveError.message)) {
        setNeedsSetup(true);
      }
      setError(saveError.message);
      setSaving(false);
      return;
    }

    setSaved({ ...drafts });
    const nextUpdated: Record<string, string> = {};
    for (const section of DOCUMENTATION_SECTIONS) {
      nextUpdated[section.key] = now;
    }
    setUpdatedAtByKey(nextUpdated);
    setSuccess("Documentation saved.");
    setSaving(false);
  }

  return (
    <AppShell>
      <PageHeader
        title="Documentation"
        description="Shared notes on how to use each part of Maison Joy Financial Manager. Anyone signed in can edit."
        action={
          <Button onClick={handleSave} loading={saving} disabled={!dirty || loading}>
            Save documentation
          </Button>
        }
      />

      {needsSetup && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-medium">Documentation table not set up yet.</p>
          <p className="mt-1">
            Run the SQL below once in Supabase, then refresh this page.
          </p>
          <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-white p-3 text-xs text-slate-800 ring-1 ring-amber-200">
            {APP_DOCUMENTATION_SETUP_SQL}
          </pre>
        </div>
      )}

      {error && !needsSetup && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">Could not load or save documentation.</p>
          <p className="mt-1">{error}</p>
          <Button variant="secondary" className="mt-3" onClick={() => void loadDocumentation()}>
            Retry
          </Button>
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {success}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading documentation...</p>
      ) : (
        <div className="space-y-6">
          {DOCUMENTATION_SECTIONS.map((section) => {
            const updatedAt = updatedAtByKey[section.key];
            const sectionDirty =
              (drafts[section.key] ?? "") !== (saved[section.key] ?? "");
            return (
              <section
                key={section.key}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
              >
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-base font-bold text-slate-900 sm:text-lg">
                    {section.title}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {sectionDirty
                      ? "Unsaved changes"
                      : updatedAt
                        ? `Updated ${formatDate(updatedAt)}`
                        : "No notes yet"}
                  </p>
                </div>
                <label className="sr-only" htmlFor={`doc-${section.key}`}>
                  Documentation for {section.title}
                </label>
                <textarea
                  id={`doc-${section.key}`}
                  value={drafts[section.key] ?? ""}
                  onChange={(event) =>
                    updateDraft(section.key, event.target.value)
                  }
                  rows={6}
                  placeholder={`How to use ${section.title}…`}
                  className="min-h-32 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-brand-500 placeholder:text-slate-400 focus:border-brand-300 focus:ring-2"
                />
              </section>
            );
          })}

          <div className="flex justify-end">
            <Button onClick={handleSave} loading={saving} disabled={!dirty}>
              Save documentation
            </Button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
