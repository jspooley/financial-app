"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { WriteOffModal } from "@/components/payments/WriteOffModal";
import { Button } from "@/components/ui/Button";
import { SelectField, editableControlClass, fieldClass, selectChevron, selectFieldClass } from "@/components/ui/FormFields";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/client";
import {
  getLedgerOutstandingBalance,
  isLedgerLineFullyPaid,
  isLedgerLineInvoiced,
} from "@/lib/invoice-utils";
import { normalizeLedgerRow, PAYMENTS_DB_SETUP_SQL, WRITE_OFF_DB_SETUP_SQL, type LedgerDbRow } from "@/lib/ledger-db";
import type { Client, LedgerEntry, PaymentType, Purchaser } from "@/lib/types";
import {
  formatCurrency,
  formatDate,
  getLedgerInvoicedAmount,
  roundMoney,
} from "@/lib/utils";

type PaymentView = "outstanding" | "history";

type PaymentRowDraft = {
  selected: boolean;
  editing: boolean;
  date_paid: string;
  paid_to: Purchaser;
  payment_type: PaymentType;
  payment_amount: number;
  payment_fee: number;
  write_off: boolean;
  write_off_amount: number;
};

function balanceFromDraft(entry: LedgerEntry, draft: PaymentRowDraft) {
  return getLedgerOutstandingBalance({
    ...entry,
    payment_amount: draft.payment_amount,
    write_off: draft.write_off,
    write_off_amount: draft.write_off_amount,
  });
}

function outstandingBeforeWriteOff(entry: LedgerEntry, draft: PaymentRowDraft) {
  return getLedgerOutstandingBalance({
    ...entry,
    payment_amount: draft.payment_amount,
    write_off: false,
    write_off_amount: 0,
  });
}

const defaultPaymentType: PaymentType = "Cash";
const defaultPaidTo: Purchaser = "Jess";

function defaultPaymentAmount(entry: LedgerEntry) {
  const saved = Number(entry.payment_amount);
  if (saved > 0) return saved;
  return getLedgerInvoicedAmount(entry);
}

function parsePaymentsDbSetupError(message: string) {
  const lower = message.toLowerCase();
  if (!lower.includes("column") && !lower.includes("schema cache")) {
    return { needsDbSetup: false, needsWriteOffSetup: false };
  }

  const missingWriteOff = lower.includes("write_off");
  const missingPayment =
    lower.includes("paid") ||
    lower.includes("payment_amount") ||
    lower.includes("payment_fee") ||
    lower.includes("payment_type");

  return {
    needsDbSetup: missingPayment || !missingWriteOff,
    needsWriteOffSetup: missingWriteOff,
  };
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
  const [needsWriteOffSetup, setNeedsWriteOffSetup] = useState(false);
  const [emptyHint, setEmptyHint] = useState<string | null>(null);
  const [clientNames, setClientNames] = useState<Map<string, string>>(new Map());
  const [writeOffModal, setWriteOffModal] = useState<{
    entryId: string;
    outstanding: number;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsDbSetup(false);
    setNeedsWriteOffSetup(false);
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
      const setup = parsePaymentsDbSetupError(message);
      if (setup.needsDbSetup) setNeedsDbSetup(true);
      if (setup.needsWriteOffSetup) setNeedsWriteOffSetup(true);
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
        !isLedgerLineFullyPaid(entry)
    );
    const paidDebits = allInvoiced.filter(
      (entry) =>
        entry.credit_debit === "debit" &&
        isLedgerLineInvoiced(entry) &&
        isLedgerLineFullyPaid(entry)
    );

    if (unpaidDebits.length === 0) {
      const invoicedDebits = allInvoiced.filter(
        (entry) => entry.credit_debit === "debit" && isLedgerLineInvoiced(entry)
      );
      const invoicedCredits = allInvoiced.filter(
        (entry) => entry.credit_debit === "credit" && isLedgerLineInvoiced(entry)
      );

      if (invoicedDebits.length > 0 && invoicedDebits.every((entry) => isLedgerLineFullyPaid(entry))) {
        setEmptyHint("All invoiced items are fully paid.");
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
    setDrafts(() => {
      const next: Record<string, PaymentRowDraft> = {};
      for (const entry of unpaidDebits) {
        next[entry.id] = {
          selected: false,
          editing: false,
          date_paid: entry.date_paid ?? today,
          paid_to: entry.paid_to ?? defaultPaidTo,
          payment_type: entry.payment_type ?? defaultPaymentType,
          payment_amount: defaultPaymentAmount(entry),
          payment_fee: Number(entry.payment_fee ?? 0),
          write_off: entry.write_off ?? false,
          write_off_amount: Number(entry.write_off_amount ?? 0),
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
        entries.reduce((sum, entry) => sum + getLedgerOutstandingBalance(entry), 0)
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
          return sum + (amount > 0 ? amount : getLedgerInvoicedAmount(entry));
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

  const clientPaidHistory = useMemo(() => {
    if (!selectedClientId) return [];
    return paidEntries
      .filter((entry) => entry.client_id === selectedClientId)
      .sort((a, b) => (b.date_paid ?? b.entry_date).localeCompare(a.date_paid ?? a.entry_date));
  }, [paidEntries, selectedClientId]);

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

  function handleAddPayment() {
    setError(null);
    setSuccess(null);
    if (!selectedClientId) {
      setError("Select a client first.");
      return;
    }
    if (filteredEntries.length === 0) {
      setError("No unpaid items for this client.");
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const target =
      filteredEntries.find((entry) => !drafts[entry.id]?.selected) ?? filteredEntries[0];
    const outstanding = getLedgerOutstandingBalance(target);

    setDrafts((current) => {
      const next = { ...current };
      for (const entry of filteredEntries) {
        next[entry.id] = {
          ...(next[entry.id] ?? {
            selected: false,
            editing: false,
            date_paid: today,
            paid_to: defaultPaidTo,
            payment_type: defaultPaymentType,
            payment_amount: 0,
            payment_fee: 0,
            write_off: false,
            write_off_amount: 0,
          }),
          selected: entry.id === target.id,
          editing: entry.id === target.id,
        };
      }
      next[target.id] = {
        ...next[target.id],
        selected: true,
        editing: true,
        date_paid: today,
        paid_to: defaultPaidTo,
        payment_type: defaultPaymentType,
        payment_amount: outstanding,
        payment_fee: 0,
        write_off: false,
        write_off_amount: 0,
      };
      return next;
    });
  }

  function handleEditSelected() {
    setError(null);
    if (selectedEntries.length === 0) {
      setError("Select at least one item to edit.");
      return;
    }
    for (const entry of selectedEntries) {
      updateDraft(entry.id, { editing: true });
    }
  }

  async function handleDeleteSelected() {
    if (selectedEntries.length === 0) {
      setError("Select at least one item to delete.");
      return;
    }
    if (!confirm(`Clear payment and write-off for ${selectedEntries.length} item(s)?`)) return;

    setError(null);
    setSuccess(null);
    setSaving(true);
    const supabase = createClient();

    for (const entry of selectedEntries) {
      const { error: updateError } = await supabase
        .from("ledger")
        .update({
          paid: false,
          date_paid: null,
          payment_amount: 0,
          payment_fee: 0,
          write_off: false,
          write_off_amount: 0,
        })
        .eq("id", entry.id);

      if (updateError) {
        setSaving(false);
        const setup = parsePaymentsDbSetupError(updateError.message);
        if (setup.needsDbSetup) setNeedsDbSetup(true);
        if (setup.needsWriteOffSetup) setNeedsWriteOffSetup(true);
        setError(updateError.message);
        return;
      }
    }

    setSaving(false);
    setSuccess(`Cleared ${selectedEntries.length} item${selectedEntries.length === 1 ? "" : "s"}.`);
    await loadData();
  }

  function handleWriteOffToggle(entry: LedgerEntry, draft: PaymentRowDraft, checked: boolean) {
    if (!checked) {
      updateDraft(entry.id, { write_off: false, write_off_amount: 0 });
      return;
    }

    const outstanding = outstandingBeforeWriteOff(entry, draft);
    if (outstanding <= 0) {
      setError("Nothing outstanding to write off.");
      return;
    }

    updateDraft(entry.id, { selected: true, editing: true });
    setWriteOffModal({ entryId: entry.id, outstanding });
  }

  async function submitUpdates() {
    setSuccess(null);
    setError(null);
    const rows = selectedEntries
      .map((entry) => ({ entry, draft: drafts[entry.id] }))
      .filter((row) => row.draft);

    if (rows.length === 0) {
      setError("Select at least one item, then click Edit or Add Payment.");
      return;
    }

    const notEditing = rows.filter(({ draft }) => !draft.editing);
    if (notEditing.length > 0) {
      setError("Click Edit on selected items before saving.");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    for (const { entry, draft } of rows) {
      const paymentAmount = roundMoney(Number(draft.payment_amount) || 0);
      const writeOffAmount = roundMoney(Number(draft.write_off_amount) || 0);
      const hasWriteOff = draft.write_off || writeOffAmount > 0;

      if (hasWriteOff) {
        const outstanding = outstandingBeforeWriteOff(entry, draft);
        if (writeOffAmount > outstanding) {
          setSaving(false);
          setError(
            "The write off amount must be less than the outstanding amount."
          );
          return;
        }
      }

      const fullyPaid = isLedgerLineFullyPaid({
        ...entry,
        payment_amount: paymentAmount,
        write_off: hasWriteOff,
        write_off_amount: hasWriteOff ? writeOffAmount : 0,
      });
      const { error: updateError } = await supabase
        .from("ledger")
        .update({
          paid: fullyPaid,
          date_paid: fullyPaid ? draft.date_paid || null : null,
          paid_to: draft.paid_to,
          payment_type: draft.payment_type,
          payment_amount: paymentAmount,
          payment_fee: Number(draft.payment_fee) || 0,
          write_off: hasWriteOff,
          write_off_amount: hasWriteOff ? writeOffAmount : 0,
        })
        .eq("id", entry.id);

      if (updateError) {
        setSaving(false);
        const setup = parsePaymentsDbSetupError(updateError.message);
        if (setup.needsDbSetup) setNeedsDbSetup(true);
        if (setup.needsWriteOffSetup) setNeedsWriteOffSetup(true);
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
        description="Record payments against invoiced amounts. Items stay open until payment equals invoiced amount."
      />

      {(needsWriteOffSetup || needsDbSetup) && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Database setup required for Payments</p>
          {needsWriteOffSetup && (
            <>
              <p className="mt-2">
                Write-offs need <code className="rounded bg-amber-100 px-1">write_off</code> and{" "}
                <code className="rounded bg-amber-100 px-1">write_off_amount</code> on the ledger
                table. Run this in Supabase SQL Editor, then refresh:
              </p>
              <pre className="mt-3 overflow-x-auto rounded-md border border-amber-200 bg-white p-3 text-xs text-slate-800">
                {WRITE_OFF_DB_SETUP_SQL}
              </pre>
            </>
          )}
          {needsDbSetup && !needsWriteOffSetup && (
            <>
              <p className="mt-2">
                Run the SQL below in Supabase SQL Editor, then refresh this page.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-md border border-amber-200 bg-white p-3 text-xs text-slate-800">
                {PAYMENTS_DB_SETUP_SQL}
              </pre>
            </>
          )}
          {needsDbSetup && needsWriteOffSetup && (
            <p className="mt-3 text-xs text-amber-900">
              If payment columns are already set up, only the write-off SQL above is required.
            </p>
          )}
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
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Client</span>
          <div className="mt-1.5 flex flex-row items-center gap-3">
            <select
              className={`${selectFieldClass} min-w-0 flex-1`}
              value={selectedClientId}
              onChange={(event) => setSelectedClientId(event.target.value)}
            >
              <option value="">Select client...</option>
              {clientsWithUnpaid.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              className="min-h-11 shrink-0 whitespace-nowrap"
              disabled={!selectedClientId || loading}
              onClick={handleAddPayment}
            >
              Add Payment
            </Button>
          </div>
          <span className="mt-1.5 block text-xs text-slate-500">
            Select a client to view payments or add a new one.
          </span>
        </label>
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
        {selectedClientId && clientPaidHistory.length > 0 && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Existing payments</h2>
            <p className="mt-1 text-xs text-slate-500">
              Fully paid items for this client.
            </p>
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {clientPaidHistory.map((entry) => {
                const paymentAmount = Number(entry.payment_amount);
                return (
                  <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <span className="font-medium text-slate-800">
                        {formatDate(entry.date_paid ?? entry.entry_date)}
                      </span>
                      <span className="text-slate-500"> · {entry.invoice_id ?? "—"}</span>
                      <span className="text-slate-500"> · {entry.description || "—"}</span>
                    </div>
                    <span className="font-medium text-brand-800">
                      {formatCurrency(
                        paymentAmount > 0 ? paymentAmount : getLedgerInvoicedAmount(entry)
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mb-2">
          <h2 className="text-sm font-semibold text-slate-900">Unpaid items</h2>
          <p className="text-xs text-slate-500">
            Select items below, then use Edit, Delete, or Save at the bottom.
          </p>
        </div>

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
                    className="mt-1 size-4 rounded border-brand-300 text-brand-600 focus:ring-brand-500"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{clientName}</p>
                    <p className="text-sm text-slate-500">
                      {formatDate(entry.entry_date)} · {entry.invoice_id ?? "No invoice ID"}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">{entry.description || "—"}</p>
                    <p className="mt-1 text-sm font-medium text-brand-800">
                      Invoiced: {formatCurrency(getLedgerInvoicedAmount(entry))}
                    </p>
                    <p className="text-sm text-amber-800">
                      Outstanding: {formatCurrency(balanceFromDraft(entry, draft))}
                    </p>
                  </div>
                </label>

                <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                  <p className="text-sm text-slate-600">
                    Status:{" "}
                    <span className="font-medium text-slate-900">
                      {isLedgerLineFullyPaid({
                        ...entry,
                        payment_amount: draft.payment_amount,
                        write_off: draft.write_off,
                        write_off_amount: draft.write_off_amount,
                      })
                        ? "Paid in full"
                        : Number(draft.payment_amount) > 0 || draft.write_off
                          ? "Partial payment"
                          : "Unpaid"}
                    </span>
                  </p>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Date paid</span>
                    <input
                      type="date"
                      value={draft.date_paid}
                      disabled={!draft.editing}
                      onChange={(event) =>
                        updateDraft(entry.id, { date_paid: event.target.value })
                      }
                      className={fieldClass}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Paid to</span>
                    <select
                      className={selectFieldClass}
                      value={draft.paid_to}
                      disabled={!draft.editing}
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
                      disabled={!draft.editing}
                      onChange={(event) =>
                        updateDraft(entry.id, {
                          payment_amount: Number(event.target.value) || 0,
                        })
                      }
                      className={fieldClass}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Payment type</span>
                    <select
                      className={selectFieldClass}
                      value={draft.payment_type}
                      disabled={!draft.editing}
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
                      disabled={!draft.editing}
                      onChange={(event) =>
                        updateDraft(entry.id, {
                          payment_fee: Number(event.target.value) || 0,
                        })
                      }
                      className={fieldClass}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.write_off}
                      disabled={!draft.editing}
                      onChange={(event) =>
                        handleWriteOffToggle(entry, draft, event.target.checked)
                      }
                      className="size-4 rounded border-brand-300 text-brand-600 focus:ring-brand-500 disabled:border-slate-300 disabled:opacity-50"
                    />
                    <span className="text-slate-700">Write off</span>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Write off amount</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={draft.write_off_amount}
                      readOnly
                      className="min-h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-slate-500"
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
                <th className="px-3 py-3">Invoiced Amount</th>
                <th className="px-3 py-3">Outstanding</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Date Paid</th>
                <th className="px-3 py-3">Paid To</th>
                <th className="px-3 py-3">Payment Amount</th>
                <th className="px-3 py-3">Payment Type</th>
                <th className="px-3 py-3">Payment Fee</th>
                <th className="px-3 py-3">Write Off</th>
                <th className="px-3 py-3">Write Off Amount</th>
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
                        className="size-4 rounded border-brand-300 text-brand-600 focus:ring-brand-500"
                      />
                    </td>
                    <td className="px-3 py-3">
                      {entry.clients?.name ?? clientNames.get(entry.client_id) ?? "—"}
                    </td>
                    <td className="px-3 py-3">{formatDate(entry.entry_date)}</td>
                    <td className="px-3 py-3">{entry.invoice_id ?? "—"}</td>
                    <td className="px-3 py-3">{entry.description || "—"}</td>
                    <td className="px-3 py-3 font-medium">
                      {formatCurrency(getLedgerInvoicedAmount(entry))}
                    </td>
                    <td className="px-3 py-3 font-medium text-amber-800">
                      {formatCurrency(balanceFromDraft(entry, draft))}
                    </td>
                    <td className="px-3 py-3">
                      {isLedgerLineFullyPaid({
                        ...entry,
                        payment_amount: draft.payment_amount,
                        write_off: draft.write_off,
                        write_off_amount: draft.write_off_amount,
                      })
                        ? "Paid in full"
                        : Number(draft.payment_amount) > 0 || draft.write_off
                          ? "Partial"
                          : "Unpaid"}
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="date"
                        value={draft.date_paid}
                        disabled={!draft.editing}
                        onChange={(event) =>
                          updateDraft(entry.id, { date_paid: event.target.value })
                        }
                        className={`min-h-10 px-2 text-sm ${editableControlClass}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <select
                        className={`min-h-10 min-w-28 cursor-pointer appearance-none bg-white bg-[length:1rem] bg-[right_0.5rem_center] bg-no-repeat px-2 py-2 pr-8 text-sm ${selectChevron} ${editableControlClass} disabled:cursor-not-allowed`}
                        value={draft.paid_to}
                        disabled={!draft.editing}
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
                        disabled={!draft.editing}
                        onChange={(event) =>
                          updateDraft(entry.id, {
                            payment_amount: Number(event.target.value) || 0,
                          })
                        }
                        className={`min-h-10 w-28 px-2 text-sm ${editableControlClass}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <select
                        className={`min-h-10 min-w-28 cursor-pointer appearance-none bg-white bg-[length:1rem] bg-[right_0.5rem_center] bg-no-repeat px-2 py-2 pr-8 text-sm ${selectChevron} ${editableControlClass} disabled:cursor-not-allowed`}
                        value={draft.payment_type}
                        disabled={!draft.editing}
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
                        disabled={!draft.editing}
                        onChange={(event) =>
                          updateDraft(entry.id, {
                            payment_fee: Number(event.target.value) || 0,
                          })
                        }
                        className={`min-h-10 w-24 px-2 text-sm ${editableControlClass}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={draft.write_off}
                        disabled={!draft.editing}
                        onChange={(event) =>
                          handleWriteOffToggle(entry, draft, event.target.checked)
                        }
                        className="size-4 rounded border-brand-300 text-brand-600 focus:ring-brand-500 disabled:border-slate-300 disabled:opacity-50"
                      />
                    </td>
                    <td className="px-3 py-3">
                      {draft.write_off
                        ? formatCurrency(draft.write_off_amount)
                        : formatCurrency(0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {clientsWithUnpaid.length > 0 && selectedClientId && filteredEntries.length > 0 && (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Selected Payment Total</p>
          <p className="text-xl font-semibold text-brand-800">
            {formatCurrency(totalPaymentAmount)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={handleEditSelected}>
            Edit
          </Button>
          <Button type="button" variant="danger" loading={saving} onClick={handleDeleteSelected}>
            Delete
          </Button>
          <Button type="button" loading={saving} onClick={submitUpdates}>
            Save
          </Button>
        </div>
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
                            paymentAmount > 0 ? paymentAmount : getLedgerInvoicedAmount(entry)
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
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Write off</dt>
                        <dd>{entry.write_off ? "Yes" : "No"}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Write off amount</dt>
                        <dd>{formatCurrency(Number(entry.write_off_amount ?? 0))}</dd>
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
                    <th className="px-3 py-3">Write Off</th>
                    <th className="px-3 py-3">Write Off Amount</th>
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
                            paymentAmount > 0 ? paymentAmount : getLedgerInvoicedAmount(entry)
                          )}
                        </td>
                        <td className="px-3 py-3">{entry.paid_to ?? "—"}</td>
                        <td className="px-3 py-3">{entry.payment_type ?? "—"}</td>
                        <td className="px-3 py-3">
                          {formatCurrency(Number(entry.payment_fee ?? 0))}
                        </td>
                        <td className="px-3 py-3">{entry.write_off ? "Yes" : "No"}</td>
                        <td className="px-3 py-3">
                          {formatCurrency(Number(entry.write_off_amount ?? 0))}
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

      {writeOffModal && (
        <WriteOffModal
          outstanding={writeOffModal.outstanding}
          onConfirm={(amount) => {
            updateDraft(writeOffModal.entryId, {
              write_off: true,
              write_off_amount: amount,
              selected: true,
              editing: true,
            });
            setWriteOffModal(null);
          }}
          onCancel={() => setWriteOffModal(null)}
        />
      )}
    </AppShell>
  );
}
