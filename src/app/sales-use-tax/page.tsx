"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { normalizeLedgerRow, updateLedgerSalesUseTaxPaid } from "@/lib/ledger-db";
import { createClient } from "@/lib/supabase/client";
import type { LedgerEntry } from "@/lib/types";
import {
  currentMonthKey,
  formatCurrency,
  formatDate,
  groupTaxDueByMonth,
  isSalesUseTaxPaid,
  salesUseTaxStatementType,
} from "@/lib/utils";

type TaxView = "unpaid" | "paid";
type StatementFilter = "" | "Bal Sheet - Personal" | "Income Statement";

type TaxRowDraft = {
  editing: boolean;
  sales_and_use_tax_paid: boolean;
};

function monthLabel(monthKey: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
  }).format(new Date(`${monthKey}-01T12:00:00`));
}

function entryDateKey(entry: Pick<LedgerEntry, "entry_date">) {
  return typeof entry.entry_date === "string" ? entry.entry_date : "";
}

function compareEntryDatesDesc(a: LedgerEntry, b: LedgerEntry) {
  return entryDateKey(b).localeCompare(entryDateKey(a));
}

function taxDraftFromEntry(entry: LedgerEntry): TaxRowDraft {
  return {
    editing: false,
    sales_and_use_tax_paid: isSalesUseTaxPaid(entry),
  };
}

export default function SalesUseTaxPaymentsPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-slate-500">Loading…</p>}>
      <SalesUseTaxPaymentsPageContent />
    </Suspense>
  );
}

function SalesUseTaxPaymentsPageContent() {
  const searchParams = useSearchParams();
  const initialView = searchParams.get("view") === "paid" ? "paid" : "unpaid";
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [view, setView] = useState<TaxView>(initialView);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState("");
  const [purchaserFilter, setPurchaserFilter] = useState<"" | "Jess" | "Molly">("");
  const [clientFilter, setClientFilter] = useState("");
  const [statementFilter, setStatementFilter] = useState<StatementFilter>("");
  const [drafts, setDrafts] = useState<Record<string, TaxRowDraft>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: dbError } = await supabase
        .from("ledger")
        .select("*, clients(name)")
        .eq("wholesale_retail", "wholesale")
        .gt("tax_amount", 0)
        .order("entry_date", { ascending: false });

      if (dbError) {
        setError(dbError.message);
        setEntries([]);
        setDrafts({});
        return;
      }

      const taxLines = (data ?? [])
        .map((row) => normalizeLedgerRow(row))
        .filter((entry) => Number(entry.tax_amount) > 0)
        .sort(compareEntryDatesDesc);
      setEntries(taxLines);
      setDrafts(() => {
        const next: Record<string, TaxRowDraft> = {};
        for (const entry of taxLines) {
          next[entry.id] = taxDraftFromEntry(entry);
        }
        return next;
      });
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "Failed to load tax entries.";
      setError(message);
      setEntries([]);
      setDrafts({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const monthOptions = useMemo(() => {
    const keys = new Set(
      entries
        .map((entry) => entryDateKey(entry).slice(0, 7))
        .filter((monthKey) => monthKey.length === 7)
    );
    return Array.from(keys).sort((a, b) => b.localeCompare(a));
  }, [entries]);

  const clientOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const entry of entries) {
      if (entry.client_id && entry.clients?.name) {
        byId.set(entry.client_id, entry.clients.name);
      }
    }
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  const matchesDimensionFilters = useCallback(
    (entry: LedgerEntry) => {
      if (monthFilter && !entryDateKey(entry).startsWith(monthFilter)) return false;
      if (purchaserFilter && entry.purchaser !== purchaserFilter) return false;
      if (clientFilter && entry.client_id !== clientFilter) return false;
      if (
        statementFilter &&
        salesUseTaxStatementType(entry) !== statementFilter
      ) {
        return false;
      }
      return true;
    },
    [monthFilter, purchaserFilter, clientFilter, statementFilter]
  );

  const dimensionFilteredEntries = useMemo(
    () => entries.filter(matchesDimensionFilters),
    [entries, matchesDimensionFilters]
  );

  const filteredUnpaidEntries = useMemo(
    () => dimensionFilteredEntries.filter((entry) => !isSalesUseTaxPaid(entry)),
    [dimensionFilteredEntries]
  );

  const filteredPaidEntries = useMemo(
    () => dimensionFilteredEntries.filter((entry) => isSalesUseTaxPaid(entry)),
    [dimensionFilteredEntries]
  );

  const filteredEntries = useMemo(() => {
    return view === "unpaid" ? filteredUnpaidEntries : filteredPaidEntries;
  }, [view, filteredUnpaidEntries, filteredPaidEntries]);

  const unpaidByStatement = useMemo(() => {
    let incomeStatement = 0;
    let balanceSheet = 0;
    for (const entry of filteredUnpaidEntries) {
      const tax = Number(entry.tax_amount) || 0;
      if (salesUseTaxStatementType(entry) === "Bal Sheet - Personal") {
        balanceSheet += tax;
      } else {
        incomeStatement += tax;
      }
    }
    return { incomeStatement, balanceSheet };
  }, [filteredUnpaidEntries]);

  const paidByStatement = useMemo(() => {
    let incomeStatement = 0;
    let balanceSheet = 0;
    for (const entry of filteredPaidEntries) {
      const tax = Number(entry.tax_amount) || 0;
      if (salesUseTaxStatementType(entry) === "Bal Sheet - Personal") {
        balanceSheet += tax;
      } else {
        incomeStatement += tax;
      }
    }
    return { incomeStatement, balanceSheet };
  }, [filteredPaidEntries]);

  const taxDueByMonth = useMemo(
    () =>
      groupTaxDueByMonth(
        filteredUnpaidEntries.filter((entry) => entryDateKey(entry).length >= 7)
      ),
    [filteredUnpaidEntries]
  );

  const totalUnpaidTax = useMemo(
    () =>
      filteredUnpaidEntries.reduce(
        (sum, entry) => sum + Number(entry.tax_amount),
        0
      ),
    [filteredUnpaidEntries]
  );

  const totalPaidTax = useMemo(
    () =>
      filteredPaidEntries.reduce(
        (sum, entry) => sum + Number(entry.tax_amount),
        0
      ),
    [filteredPaidEntries]
  );

  const summaryMonthKey = monthFilter || currentMonthKey();
  const summaryMonthTax = taxDueByMonth.find(
    (row) => row.monthKey === summaryMonthKey
  );
  const summaryMonthTaxDue = summaryMonthTax?.amount ?? 0;
  const summaryMonthJessTaxDue = summaryMonthTax?.jess ?? 0;
  const summaryMonthMollyTaxDue = summaryMonthTax?.molly ?? 0;
  const summaryMonthLabel = monthLabel(summaryMonthKey);

  const editingEntries = useMemo(
    () => filteredEntries.filter((entry) => drafts[entry.id]?.editing),
    [filteredEntries, drafts]
  );

  const editingTaxTotal = useMemo(
    () =>
      editingEntries.reduce((sum, entry) => sum + Number(entry.tax_amount), 0),
    [editingEntries]
  );

  function updateDraft(entryId: string, patch: Partial<TaxRowDraft>) {
    setDrafts((current) => {
      const existing = current[entryId];
      if (!existing) return current;
      return { ...current, [entryId]: { ...existing, ...patch } };
    });
    setSuccess(null);
  }

  function resetDraftFromEntry(entry: LedgerEntry) {
    updateDraft(entry.id, taxDraftFromEntry(entry));
  }

  function beginEdit(entry: LedgerEntry) {
    setError(null);
    updateDraft(entry.id, { editing: true });
  }

  function cancelRowEdit(entry: LedgerEntry) {
    setError(null);
    resetDraftFromEntry(entry);
  }

  async function submitUpdates() {
    setSuccess(null);
    setError(null);

    const rows = editingEntries
      .map((entry) => ({ entry, draft: drafts[entry.id] }))
      .filter((row) => row.draft);

    if (rows.length === 0) {
      setError("Click Edit on at least one item before saving.");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    for (const { entry, draft } of rows) {
      const { error: updateError } = await updateLedgerSalesUseTaxPaid(
        supabase,
        entry.id,
        draft.sales_and_use_tax_paid
      );
      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setSuccess(`Updated ${rows.length} ${rows.length === 1 ? "entry" : "entries"}.`);
    await loadData();
  }

  return (
    <AppShell>
      <PageHeader
        title="Sales & Use Tax"
        description="All wholesale ledger tax lines, including Bal Sheet - Personal and Income Statement. Mark entries paid when remitted to the state."
      />

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Sales and Use Tax Due by the 20th of each month
            </h2>
            <p className="text-sm text-slate-600">
              Unpaid tax for {summaryMonthLabel}, using the filters below (purchaser,
              client, statement).
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-right sm:justify-end sm:gap-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Jess ({summaryMonthLabel})
              </p>
              <p className="text-xl font-semibold text-brand-800">
                {formatCurrency(summaryMonthJessTaxDue)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Molly ({summaryMonthLabel})
              </p>
              <p className="text-xl font-semibold text-brand-800">
                {formatCurrency(summaryMonthMollyTaxDue)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Total ({summaryMonthLabel})
              </p>
              <p className="text-xl font-semibold text-slate-900">
                {formatCurrency(summaryMonthTaxDue)}
              </p>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {success}
        </div>
      )}

      <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Month</span>
          <select
            value={monthFilter}
            onChange={(event) => setMonthFilter(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All months</option>
            {monthOptions.map((monthKeyOption) => (
              <option key={monthKeyOption} value={monthKeyOption}>
                {monthLabel(monthKeyOption)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Purchaser</span>
          <select
            value={purchaserFilter}
            onChange={(event) =>
              setPurchaserFilter(event.target.value as "" | "Jess" | "Molly")
            }
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All purchasers</option>
            <option value="Jess">Jess</option>
            <option value="Molly">Molly</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Client</span>
          <select
            value={clientFilter}
            onChange={(event) => setClientFilter(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All clients</option>
            {clientOptions.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Statement</span>
          <select
            value={statementFilter}
            onChange={(event) =>
              setStatementFilter(event.target.value as StatementFilter)
            }
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All statements</option>
            <option value="Income Statement">Income Statement</option>
            <option value="Bal Sheet - Personal">Bal Sheet - Personal</option>
          </select>
        </label>
      </div>

      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Unpaid entries</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {filteredUnpaidEntries.length}
          </p>
          <p className="mt-1 text-sm text-brand-800">
            {formatCurrency(totalUnpaidTax)}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Income Statement {formatCurrency(unpaidByStatement.incomeStatement)} · Bal
            Sheet {formatCurrency(unpaidByStatement.balanceSheet)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Paid entries</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {filteredPaidEntries.length}
          </p>
          <p className="mt-1 text-sm text-slate-800">
            {formatCurrency(totalPaidTax)}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Income Statement {formatCurrency(paidByStatement.incomeStatement)} · Bal
            Sheet {formatCurrency(paidByStatement.balanceSheet)}
          </p>
        </div>
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-600">
            Filtered tax total
          </p>
          <p className="mt-1 text-2xl font-bold text-brand-800">
            {formatCurrency(totalUnpaidTax + totalPaidTax)}
          </p>
          <p className="mt-2 text-xs text-slate-600">
            {dimensionFilteredEntries.length}{" "}
            {dimensionFilteredEntries.length === 1 ? "entry" : "entries"} match filters
          </p>
        </div>
      </section>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setView("unpaid")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition ${
              view === "unpaid"
                ? "bg-brand-600 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Unpaid ({filteredUnpaidEntries.length})
          </button>
          <button
            type="button"
            onClick={() => setView("paid")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition ${
              view === "paid"
                ? "bg-brand-600 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Paid ({filteredPaidEntries.length})
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading tax entries…</p>
      ) : filteredEntries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          {view === "unpaid"
            ? "No unpaid sales and use tax match these filters."
            : "No paid tax entries match these filters."}
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-500">
            Click Edit on a row, change Tax Paid, then Save. Cancel discards changes for that
            row.
          </p>

          <div className="space-y-3 md:hidden">
            {filteredEntries.map((entry) => {
              const draft = drafts[entry.id];
              if (!draft) return null;

              return (
                <article
                  key={entry.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm text-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex w-21 shrink-0 flex-col gap-1.5">
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full min-h-[33px] px-3 py-1.5"
                        onClick={() => beginEdit(entry)}
                        disabled={draft.editing}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        className="w-full min-h-[33px] px-3 py-1.5"
                        onClick={() => cancelRowEdit(entry)}
                        disabled={!draft.editing}
                      >
                        Cancel
                      </Button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">
                        {entry.clients?.name ?? "—"}
                      </p>
                      <p className="text-slate-500">
                        {formatDate(entry.entry_date)} · {entry.po_number ?? "—"}
                      </p>
                      <p className="mt-1 text-slate-700">{entry.description?.trim() || "—"}</p>
                      <p className="mt-1 font-medium text-brand-800">
                        Tax: {formatCurrency(Number(entry.tax_amount))}
                      </p>
                      <p className="text-slate-600">
                        Statement: {salesUseTaxStatementType(entry)}
                      </p>
                      <p className="text-slate-600">Purchaser: {entry.purchaser ?? "—"}</p>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={draft.sales_and_use_tax_paid}
                        disabled={!draft.editing}
                        onChange={(event) =>
                          updateDraft(entry.id, {
                            sales_and_use_tax_paid: event.target.checked,
                          })
                        }
                        className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50"
                      />
                      <span className="text-slate-700">
                        Tax paid: {draft.sales_and_use_tax_paid ? "Paid" : "Unpaid"}
                      </span>
                    </label>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-3">Actions</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Client</th>
                  <th className="px-3 py-3">Description</th>
                  <th className="px-3 py-3">PO</th>
                  <th className="px-3 py-3">Statement</th>
                  <th className="px-3 py-3 text-right">Tax</th>
                  <th className="px-3 py-3">Purchaser</th>
                  <th className="px-3 py-3">Tax Paid</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => {
                  const draft = drafts[entry.id];
                  if (!draft) return null;
                  const statementType = salesUseTaxStatementType(entry);

                  return (
                    <tr key={entry.id} className="border-t border-slate-100">
                      <td className="px-3 py-3">
                        <div className="flex w-21 flex-col gap-1.5">
                          <Button
                            type="button"
                            variant="secondary"
                            className="w-full min-h-[33px] px-3 py-1.5"
                            onClick={() => beginEdit(entry)}
                            disabled={draft.editing}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            className="w-full min-h-[33px] px-3 py-1.5"
                            onClick={() => cancelRowEdit(entry)}
                            disabled={!draft.editing}
                          >
                            Cancel
                          </Button>
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {formatDate(entry.entry_date)}
                      </td>
                      <td className="px-3 py-3">{entry.clients?.name ?? "—"}</td>
                      <td className="px-3 py-3">{entry.description?.trim() || "—"}</td>
                      <td className="px-3 py-3">{entry.po_number ?? "—"}</td>
                      <td className="px-3 py-3">
                        <span
                          className={
                            statementType === "Bal Sheet - Personal"
                              ? "text-slate-800"
                              : "text-brand-800"
                          }
                        >
                          {statementType}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-medium">
                        {formatCurrency(Number(entry.tax_amount))}
                      </td>
                      <td className="px-3 py-3">{entry.purchaser ?? "—"}</td>
                      <td className="px-3 py-3">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={draft.sales_and_use_tax_paid}
                            disabled={!draft.editing}
                            onChange={(event) =>
                              updateDraft(entry.id, {
                                sales_and_use_tax_paid: event.target.checked,
                              })
                            }
                            className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50"
                          />
                          <span className="text-slate-600">
                            {draft.sales_and_use_tax_paid ? "Paid" : "Unpaid"}
                          </span>
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Editing tax total
              </p>
              <p className="text-xl font-semibold text-brand-800">
                {formatCurrency(editingTaxTotal)}
              </p>
            </div>
            <Button type="button" loading={saving} onClick={submitUpdates}>
              Save
            </Button>
          </div>
        </>
      )}

      {view === "unpaid" && taxDueByMonth.length > 0 && (
        <p className="mt-6 text-sm text-slate-600">
          <Link href="/" className="font-medium text-brand-700 hover:underline">
            View monthly summary on Overview →
          </Link>
        </p>
      )}
    </AppShell>
  );
}
