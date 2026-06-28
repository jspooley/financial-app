"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/FormFields";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/client";
import {
  isLedgerLineInvoiced,
  isLedgerLineUnpaid,
} from "@/lib/invoice-utils";
import { normalizeLedgerRow, PAYMENTS_DB_SETUP_SQL, type LedgerDbRow } from "@/lib/ledger-db";
import type { Client, LedgerEntry, PaymentType, Purchaser } from "@/lib/types";
import {
  formatCurrency,
  formatDate,
  getLedgerCustomerPrice,
  getLedgerTotalDesignerCost,
  roundMoney,
} from "@/lib/utils";

type PaymentView = "outstanding" | "history";

type PaymentRowDraft = {
  selected: boolean;
  paid: boolean;
  date_paid: string;
  paid_to: Purchaser;
  payment_type: PaymentType;
  payment_amount: number;
  payment_fee: number;
};

const defaultPaymentType: PaymentType = "Cash";
const defaultPaidTo: Purchaser = "Jess";

function defaultPaymentAmount(entry: LedgerEntry) {
  const saved = Number(entry.payment_amount);
  if (saved > 0) return saved;
  return getLedgerCustomerPrice(entry);
}

export default function PaymentsPage() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [paidEntries, setPaidEntries] = useState<LedgerEntry[]>([]);
  const [view, setView] = useState<PaymentView>("outstanding");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [historyClientId, setHistoryClientId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, PaymentRowDraft>>({});
  const [needsDbSetup, setNeedsDbSetup] = useState(false);
  const [emptyHint, setEmptyHint] = useState<string | null>(null);
  const [clientNames, setClientNames] = useState<Map<string, string>>(new Map());

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsDbSetup(false);
    const supabase = createClient();
    const [{ data, error: dbError }, { data: clientData, error: clientError }, { data: invoiceData }] =
      await Promise.all([
        supabase
          .from("ledger")
          .select("*, clients(name)")
          .or("invoiced.eq.true,invoice_id.not.is.null")
          .order("entry_date", { ascending: false }),
        supabase.from("clients").select("id, name").order("name", { ascending: true }),
        supabase.from("invoicing").select("id, client_id, invoice_id"),
      ]);

    const names = new Map(
      (clientData ?? []).map((client: Pick<Client, "id" | "name">) => [client.id, client.name])
    );
    setClientNames(names);

    if (dbError ?? clientError) {
      const message = (dbError ?? clientError)!.message;
      const lower = message.toLowerCase();
      const missingColumn =
        lower.includes("column") || lower.includes("schema cache");
      if (
        missingColumn &&
        (lower.includes("paid") ||
          lower.includes("payment_amount") ||
          lower.includes("payment_fee") ||
          lower.includes("payment_type"))
      ) {
        setNeedsDbSetup(true);
      }
      setError(message);
      setEntries([]);
      setPaidEntries([]);
      setEmptyHint(null);
      setLoading(false);
      return;
    }

    const allInvoiced = (data ?? []).map((row) =>
      normalizeLedgerRow(row as LedgerDbRow & Record<string, unknown>)
    );
    const unpaidDebits = allInvoiced.filter(
      (entry) =>
        entry.credit_debit === "debit" &&
        isLedgerLineInvoiced(entry) &&
        isLedgerLineUnpaid(entry)
    );
    const paidDebits = allInvoiced.filter(
      (entry) =>
        entry.credit_debit === "debit" &&
        isLedgerLineInvoiced(entry) &&
        entry.paid
    );

    if (unpaidDebits.length === 0) {
      const invoicedDebits = allInvoiced.filter(
        (entry) => entry.credit_debit === "debit" && isLedgerLineInvoiced(entry)
      );
      const invoicedCredits = allInvoiced.filter(
        (entry) => entry.credit_debit === "credit" && isLedgerLineInvoiced(entry)
      );

      if (invoicedDebits.length > 0 && invoicedDebits.every((entry) => entry.paid)) {
        setEmptyHint("All invoiced items are already marked paid.");
      } else if (invoicedCredits.length > 0 && invoicedDebits.length === 0) {
        setEmptyHint(
          "Invoiced items exist, but they are credits. Payments is for debit lines — invoice debit ledger entries from the Invoicing page."
        );
      } else if ((invoiceData ?? []).length > 0) {
        setEmptyHint(
          "Invoices exist but no unpaid debit ledger lines are linked. On the Invoicing page, edit an invoice and include debit ledger items for that PO."
        );
      } else {
        setEmptyHint(
          "No invoiced debit items yet. Add debit ledger entries and include them on an invoice from the Invoicing page."
        );
      }
    } else {
      setEmptyHint(null);
    }

    setEntries(unpaidDebits);
    setPaidEntries(paidDebits);

    const today = new Date().toISOString().slice(0, 10);
    setDrafts((current) => {
      const next: Record<string, PaymentRowDraft> = {};
      for (const entry of unpaidDebits) {
        next[entry.id] = current[entry.id] ?? {
          selected: false,
          paid: true,
          date_paid: entry.date_paid ?? today,
          paid_to: entry.paid_to ?? defaultPaidTo,
          payment_type: entry.payment_type ?? defaultPaymentType,
          payment_amount: defaultPaymentAmount(entry),
          payment_fee: Number(entry.payment_fee ?? 0),
        };
      }
      return next;
    });

    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const outstandingSummary = useMemo(
    () => ({
      count: entries.length,
      amount: roundMoney(
        entries.reduce((sum, entry) => sum + getLedgerCustomerPrice(entry), 0)
      ),
    }),
    [entries]
  );

  const clientsWithPaid = useMemo(() => {
    const byId = new Map<string, string>();
    for (const entry of paidEntries) {
      if (!entry.client_id) continue;
      const name = entry.clients?.name ?? clientNames.get(entry.client_id);
      if (name) byId.set(entry.client_id, name);
    }
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [paidEntries, clientNames]);

  const filteredPaidEntries = useMemo(() => {
    const rows = historyClientId
      ? paidEntries.filter((entry) => entry.client_id === historyClientId)
      : paidEntries;
    return [...rows].sort((a, b) => {
      const dateA = a.date_paid ?? a.entry_date;
      const dateB = b.date_paid ?? b.entry_date;
      return dateB.localeCompare(dateA);
    });
  }, [paidEntries, historyClientId]);

  const paidHistoryTotal = useMemo(
    () =>
      roundMoney(
        filteredPaidEntries.reduce((sum, entry) => {
          const amount = Number(entry.payment_amount);
          return sum + (amount > 0 ? amount : getLedgerCustomerPrice(entry));
        }, 0)
      ),
    [filteredPaidEntries]
  );

  const clientsWithUnpaid = useMemo(() => {
    const byId = new Map<string, string>();
    for (const entry of entries) {
      if (!entry.client_id) continue;
      const name = entry.clients?.name ?? clientNames.get(entry.client_id);
      if (name) {
        byId.set(entry.client_id, name);
      }
    }
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, clientNames]);

  const filteredEntries = useMemo(() => {
    if (!selectedClientId) return [];
    return entries.filter((entry) => entry.client_id === selectedClientId);
  }, [entries, selectedClientId]);

  useEffect(() => {
    if (
      selectedClientId &&
      !clientsWithUnpaid.some((client) => client.id === selectedClientId)
    ) {
      setSelectedClientId("");
    }
  }, [clientsWithUnpaid, selectedClientId]);

  const selectedEntries = useMemo(
    () => filteredEntries.filter((entry) => drafts[entry.id]?.selected),
    [filteredEntries, drafts]
  );

  const totalPaymentAmount = useMemo(
    () =>
      selectedEntries.reduce(
        (sum, entry) => sum + (Number(drafts[entry.id]?.payment_amount) || 0),
        0
      ),
    [selectedEntries, drafts]
  );

  function updateDraft(entryId: string, patch: Partial<PaymentRowDraft>) {
    setDrafts((current) => {
      const existing = current[entryId];
      if (!existing) return current;
      return { ...current, [entryId]: { ...existing, ...patch } };
    });
  }

  async function submitUpdates() {
    setSuccess(null);
    setError(null);
    const rows = selectedEntries
      .map((entry) => ({ entry, draft: drafts[entry.id] }))
      .filter((row) => row.draft);

    if (rows.length === 0) {
      setError("Select at least one item to update.");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    for (const { entry, draft } of rows) {
      const { error: updateError } = await supabase
        .from("ledger")
        .update({
          paid: draft.paid,
          date_paid: draft.date_paid || null,
          paid_to: draft.paid_to,
          payment_type: draft.payment_type,
          payment_amount: Number(draft.payment_amount) || 0,
          payment_fee: Number(draft.payment_fee) || 0,
        })
        .eq("id", entry.id);

      if (updateError) {
        setSaving(false);
        const lower = updateError.message.toLowerCase();
        if (
          lower.includes("payment_amount") &&
          (lower.includes("column") || lower.includes("schema cache"))
        ) {
          setNeedsDbSetup(true);
        }
        setError(updateError.message);
        return;
      }
    }

    setSaving(false);
    setSuccess(`Updated ${rows.length} item${rows.length === 1 ? "" : "s"}.`);
    await loadData();
  }

  return (
    <AppShell>
      <PageHeader
        title="Payments"
        description="Select invoiced debit items, record payment details, and update the ledger."
      />

      {needsDbSetup && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Database setup required for Payments</p>
          <p className="mt-2">
            Run the SQL below in Supabase SQL Editor, then refresh this page.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md border border-amber-200 bg-white p-3 text-xs text-slate-800">
            {PAYMENTS_DB_SETUP_SQL}
          </pre>
        </div>
      )}

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Outstanding Payments</p>
          <p className="mt-1 text-2xl font-semibold text-amber-800">
            {formatCurrency(outstandingSummary.amount)}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {outstandingSummary.count}{" "}
            {outstandingSummary.count === 1 ? "item" : "items"} awaiting payment
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Payments Recorded</p>
          <p className="mt-1 text-2xl font-semibold text-brand-800">
            {paidEntries.length}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Paid invoiced items in ledger history
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant={view === "outstanding" ? "primary" : "secondary"}
          onClick={() => setView("outstanding")}
        >
          Outstanding
        </Button>
        <Button
          type="button"
          variant={view === "history" ? "primary" : "secondary"}
          onClick={() => setView("history")}
        >
          Payment History
        </Button>
      </div>

      {view === "outstanding" ? (
        <>
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <SelectField
          label="Client"
          hint="Only clients with unpaid invoiced debit items are listed."
          value={selectedClientId}
          onChange={(event) => setSelectedClientId(event.target.value)}
        >
          <option value="">Select client...</option>
          {clientsWithUnpaid.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </SelectField>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading items...</p>
      ) : clientsWithUnpaid.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          <p>{emptyHint ?? "No invoiced unpaid debit items found."}</p>
          {paidEntries.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              className="mt-4"
              onClick={() => setView("history")}
            >
              View Payment History
            </Button>
          )}
        </div>
      ) : !selectedClientId ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Select a client to view unpaid debit items.
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No unpaid debit items for this client.
        </div>
      ) : (
        <>
        <div className="space-y-3 md:hidden">
          {filteredEntries.map((entry) => {
            const draft = drafts[entry.id];
            if (!draft) return null;
            const clientName =
              entry.clients?.name ?? clientNames.get(entry.client_id) ?? "—";

            return (
              <article
                key={entry.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={draft.selected}
                    onChange={(event) =>
                      updateDraft(entry.id, { selected: event.target.checked })
                    }
                    className="mt-1 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{clientName}</p>
                    <p className="text-sm text-slate-500">
                      {formatDate(entry.entry_date)} · {entry.invoice_id ?? "No invoice ID"}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">{entry.description || "—"}</p>
                    <p className="mt-1 text-sm font-medium text-brand-800">
                      Designer cost: {formatCurrency(getLedgerTotalDesignerCost(entry))}
                    </p>
                  </div>
                </label>

                <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.paid}
                      disabled={!draft.selected}
                      onChange={(event) => updateDraft(entry.id, { paid: event.target.checked })}
                      className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50"
                    />
                    <span>Mark paid</span>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Date paid</span>
                    <input
                      type="date"
                      value={draft.date_paid}
                      disabled={!draft.selected}
                      onChange={(event) =>
                        updateDraft(entry.id, { date_paid: event.target.value })
                      }
                      className="min-h-11 w-full rounded-lg border border-slate-300 px-3 disabled:opacity-50"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Paid to</span>
                    <select
                      className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 disabled:opacity-50"
                      value={draft.paid_to}
                      disabled={!draft.selected}
                      onChange={(event) =>
                        updateDraft(entry.id, { paid_to: event.target.value as Purchaser })
                      }
                    >
                      <option value="Jess">Jess</option>
                      <option value="Molly">Molly</option>
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Payment amount</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={draft.payment_amount}
                      disabled={!draft.selected}
                      onChange={(event) =>
                        updateDraft(entry.id, {
                          payment_amount: Number(event.target.value) || 0,
                        })
                      }
                      className="min-h-11 w-full rounded-lg border border-slate-300 px-3 disabled:opacity-50"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Payment type</span>
                    <select
                      className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 disabled:opacity-50"
                      value={draft.payment_type}
                      disabled={!draft.selected}
                      onChange={(event) =>
                        updateDraft(entry.id, {
                          payment_type: event.target.value as PaymentType,
                        })
                      }
                    >
                      <option value="Cash">Cash</option>
                      <option value="Check">Check</option>
                      <option value="CC">CC</option>
                      <option value="Other">Other</option>
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Payment fee</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={draft.payment_fee}
                      disabled={!draft.selected}
                      onChange={(event) =>
                        updateDraft(entry.id, {
                          payment_fee: Number(event.target.value) || 0,
                        })
                      }
                      className="min-h-11 w-full rounded-lg border border-slate-300 px-3 disabled:opacity-50"
                    />
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
                <th className="px-3 py-3">Select</th>
                <th className="px-3 py-3">Client</th>
                <th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">Invoice ID</th>
                <th className="px-3 py-3">Description</th>
                <th className="px-3 py-3">Total Designer Cost</th>
                <th className="px-3 py-3">Paid</th>
                <th className="px-3 py-3">Date Paid</th>
                <th className="px-3 py-3">Paid To</th>
                <th className="px-3 py-3">Payment Amount</th>
                <th className="px-3 py-3">Payment Type</th>
                <th className="px-3 py-3">Payment Fee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredEntries.map((entry) => {
                const draft = drafts[entry.id];
                if (!draft) return null;

                return (
                  <tr key={entry.id}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={draft.selected}
                        onChange={(event) =>
                          updateDraft(entry.id, { selected: event.target.checked })
                        }
                        className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                    </td>
                    <td className="px-3 py-3">
                      {entry.clients?.name ?? clientNames.get(entry.client_id) ?? "—"}
                    </td>
                    <td className="px-3 py-3">{formatDate(entry.entry_date)}</td>
                    <td className="px-3 py-3">{entry.invoice_id ?? "—"}</td>
                    <td className="px-3 py-3">{entry.description || "—"}</td>
                    <td className="px-3 py-3 font-medium text-brand-800">
                      {formatCurrency(getLedgerTotalDesignerCost(entry))}
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={draft.paid}
                        disabled={!draft.selected}
                        onChange={(event) => updateDraft(entry.id, { paid: event.target.checked })}
                        className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="date"
                        value={draft.date_paid}
                        disabled={!draft.selected}
                        onChange={(event) =>
                          updateDraft(entry.id, { date_paid: event.target.value })
                        }
                        className="min-h-10 rounded-lg border border-slate-300 px-2 text-sm disabled:opacity-50"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <select
                        className="min-h-10 min-w-28 rounded-lg border border-slate-300 bg-white px-2 text-sm disabled:opacity-50"
                        value={draft.paid_to}
                        disabled={!draft.selected}
                        onChange={(event) =>
                          updateDraft(entry.id, { paid_to: event.target.value as Purchaser })
                        }
                      >
                        <option value="Jess">Jess</option>
                        <option value="Molly">Molly</option>
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={draft.payment_amount}
                        disabled={!draft.selected}
                        onChange={(event) =>
                          updateDraft(entry.id, {
                            payment_amount: Number(event.target.value) || 0,
                          })
                        }
                        className="min-h-10 w-28 rounded-lg border border-slate-300 px-2 text-sm disabled:opacity-50"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <select
                        className="min-h-10 min-w-28 rounded-lg border border-slate-300 bg-white px-2 text-sm disabled:opacity-50"
                        value={draft.payment_type}
                        disabled={!draft.selected}
                        onChange={(event) =>
                          updateDraft(entry.id, {
                            payment_type: event.target.value as PaymentType,
                          })
                        }
                      >
                        <option value="Cash">Cash</option>
                        <option value="Check">Check</option>
                        <option value="CC">CC</option>
                        <option value="Other">Other</option>
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={draft.payment_fee}
                        disabled={!draft.selected}
                        onChange={(event) =>
                          updateDraft(entry.id, {
                            payment_fee: Number(event.target.value) || 0,
                          })
                        }
                        className="min-h-10 w-24 rounded-lg border border-slate-300 px-2 text-sm disabled:opacity-50"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {clientsWithUnpaid.length > 0 && (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Selected Payment Total</p>
          <p className="text-xl font-semibold text-brand-800">
            {formatCurrency(totalPaymentAmount)}
          </p>
        </div>
        <Button type="button" loading={saving} onClick={submitUpdates}>
          Submit Payments
        </Button>
      </div>
      )}
        </>
      ) : (
        <>
          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <SelectField
              label="Client"
              hint="Filter payment history by client, or leave blank to show all."
              value={historyClientId}
              onChange={(event) => setHistoryClientId(event.target.value)}
            >
              <option value="">All clients</option>
              {clientsWithPaid.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </SelectField>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">Loading payment history...</p>
          ) : filteredPaidEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              <p>No paid invoiced items recorded yet.</p>
            </div>
          ) : (
            <>
            <div className="space-y-3 md:hidden">
              {filteredPaidEntries.map((entry) => {
                const paymentAmount = Number(entry.payment_amount);
                return (
                  <article
                    key={entry.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm text-sm"
                  >
                    <p className="font-medium text-slate-900">
                      {entry.clients?.name ?? clientNames.get(entry.client_id) ?? "—"}
                    </p>
                    <dl className="mt-3 space-y-2">
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Date paid</dt>
                        <dd>{formatDate(entry.date_paid)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Invoice ID</dt>
                        <dd>{entry.invoice_id ?? "—"}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Description</dt>
                        <dd className="text-right">{entry.description || "—"}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Amount</dt>
                        <dd className="font-medium text-brand-800">
                          {formatCurrency(
                            paymentAmount > 0 ? paymentAmount : getLedgerCustomerPrice(entry)
                          )}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Paid to</dt>
                        <dd>{entry.paid_to ?? "—"}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Type</dt>
                        <dd>{entry.payment_type ?? "—"}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Fee</dt>
                        <dd>{formatCurrency(Number(entry.payment_fee ?? 0))}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-3 py-3">Client</th>
                    <th className="px-3 py-3">Date Paid</th>
                    <th className="px-3 py-3">Invoice ID</th>
                    <th className="px-3 py-3">Description</th>
                    <th className="px-3 py-3">Payment Amount</th>
                    <th className="px-3 py-3">Paid To</th>
                    <th className="px-3 py-3">Payment Type</th>
                    <th className="px-3 py-3">Payment Fee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPaidEntries.map((entry) => {
                    const paymentAmount = Number(entry.payment_amount);
                    return (
                      <tr key={entry.id}>
                        <td className="px-3 py-3">
                          {entry.clients?.name ?? clientNames.get(entry.client_id) ?? "—"}
                        </td>
                        <td className="px-3 py-3">{formatDate(entry.date_paid)}</td>
                        <td className="px-3 py-3">{entry.invoice_id ?? "—"}</td>
                        <td className="px-3 py-3">{entry.description || "—"}</td>
                        <td className="px-3 py-3 font-medium text-brand-800">
                          {formatCurrency(
                            paymentAmount > 0 ? paymentAmount : getLedgerCustomerPrice(entry)
                          )}
                        </td>
                        <td className="px-3 py-3">{entry.paid_to ?? "—"}</td>
                        <td className="px-3 py-3">{entry.payment_type ?? "—"}</td>
                        <td className="px-3 py-3">
                          {formatCurrency(Number(entry.payment_fee ?? 0))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}

          {filteredPaidEntries.length > 0 && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {historyClientId ? "Filtered payment total" : "Total payments shown"}
              </p>
              <p className="mt-1 text-xl font-semibold text-brand-800">
                {formatCurrency(paidHistoryTotal)}
              </p>
            </div>
          )}
        </>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {success && <p className="mt-3 text-sm text-brand-700">{success}</p>}
    </AppShell>
  );
}
