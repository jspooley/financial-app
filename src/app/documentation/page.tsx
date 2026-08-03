"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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

const DOCUMENTATION_PATH = "/documentation";

function emptyDrafts(): DraftMap {
  const drafts: DraftMap = {};
  for (const section of DOCUMENTATION_SECTIONS) {
    drafts[section.key] = "";
  }
  return drafts;
}

function isSameDocumentationPath(href: string) {
  try {
    const url = new URL(href, window.location.origin);
    return url.pathname === DOCUMENTATION_PATH;
  } catch {
    return href === DOCUMENTATION_PATH;
  }
}

export default function DocumentationPage() {
  const router = useRouter();
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
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const dirty = useMemo(
    () =>
      DOCUMENTATION_SECTIONS.some(
        (section) => (drafts[section.key] ?? "") !== (saved[section.key] ?? "")
      ),
    [drafts, saved]
  );
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

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

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    if (!dirty) return;

    function onDocumentClick(event: MouseEvent) {
      if (!dirtyRef.current) return;
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(href, window.location.origin);
      } catch {
        return;
      }

      if (nextUrl.origin !== window.location.origin) return;
      if (isSameDocumentationPath(nextUrl.pathname)) return;

      event.preventDefault();
      event.stopPropagation();
      setPendingHref(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    }

    document.addEventListener("click", onDocumentClick, true);
    return () => document.removeEventListener("click", onDocumentClick, true);
  }, [dirty]);

  useEffect(() => {
    if (!pendingHref) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPendingHref(null);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingHref]);

  function updateDraft(key: string, value: string) {
    setDrafts((current) => ({ ...current, [key]: value }));
    setSuccess(null);
  }

  function handleStayOnPage() {
    setPendingHref(null);
  }

  function handleLeaveWithoutSaving() {
    if (!pendingHref) return;
    const href = pendingHref;
    setPendingHref(null);
    dirtyRef.current = false;
    router.push(href);
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
      {pendingHref && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="unsaved-docs-title"
        >
          <div className="w-full max-w-md rounded-xl border border-amber-200 bg-white p-5 shadow-lg">
            <h2
              id="unsaved-docs-title"
              className="text-lg font-semibold text-slate-900"
            >
              Save before leaving?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              You have unsaved documentation changes. Save before leaving this
              page, or your updates will be lost.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={handleStayOnPage}>
                Stay on page
              </Button>
              <Button variant="danger" onClick={handleLeaveWithoutSaving}>
                Leave without saving
              </Button>
            </div>
          </div>
        </div>
      )}

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
