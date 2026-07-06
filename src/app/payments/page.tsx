"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ExpenseModal } from "@/components/payments/ExpenseModal";
import { Button } from "@/components/ui/Button";
import { SelectField, editableControlClass, fieldClass, selectChevron, selectFieldClass } from "@/components/ui/FormFields";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/client";
import {
  getLedgerOutstandingBalance,
  getLedgerTotalPaymentReceived,
  getLedgerUnderpaymentAmount,
  isLedgerLineFullyPaid,
  deriveLedgerPaidFlag,
  isLedgerLineInvoiced,
  ledgerLineAmount,
  ledgerLineAmountSettled,
  sumPaymentsHistoryTotal,
  summarizePaymentsByInvoiceId,
  normalizeInvoiceId,
} from "@/lib/invoice-utils";
import { normalizeLedgerRow, PAYMENTS_DB_SETUP_SQL, EXPENSE_DB_SETUP_SQL, type LedgerDbRow } from "@/lib/ledger-db";
import {
  PAYMENT_TYPE_OPTIONS,
  type Client,
  type LedgerEntry,
  type PaymentType,
  type Purchaser,
} from "@/lib/types";
import {
  calculateAutoPaymentFee,
  formatCurrency,
  formatDate,
  getLedgerInvoicedAmount,
  paymentTypeHasAutoFee,
  roundMoney,
  toDateInputValue,
  todayDateInputValue,
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
  payment_fee_manually_edited: boolean;
  expense: boolean;
  expense_amount: number;
};

function entryFromDraft(entry: LedgerEntry, draft: PaymentRowDraft): LedgerEntry {
  const hasExpense = draft.expense || Number(draft.expense_amount) > 0;
  return {
    ...entry,
    payment_amount: roundMoney(Number(draft.payment_amount) || 0),
    payment_fee: Number(draft.payment_fee) || 0,
    expense: hasExpense,
    expense_amount: hasExpense ? roundMoney(Number(draft.expense_amount) || 0) : 0,
  };
}

function paymentLineForDisplay(entry: LedgerEntry, draft: PaymentRowDraft) {
  return draft.editing ? entryFromDraft(entry, draft) : entry;
}

function lineOutstandingBalance(entry: LedgerEntry, draft: PaymentRowDraft) {
  return getLedgerUnderpaymentAmount(entryFromDraft(entry, draft));
}

function paymentReceivedForDraft(entry: LedgerEntry, draft: PaymentRowDraft) {
  return getLedgerTotalPaymentReceived(entryFromDraft(entry, draft));
}

function paymentsReceivedForLine(entry: LedgerEntry, draft: PaymentRowDraft) {
  return ledgerLineAmountSettled(entryFromDraft(entry, draft));
}

function paymentAmountForLine(entry: LedgerEntry, draft: PaymentRowDraft) {
  return roundMoney(Number(entryFromDraft(entry, draft).payment_amount ?? 0));
}

function outstandingBalanceClass(amount: number) {
  if (amount < 0) return "text-brand-800";
  if (amount > 0) return "text-amber-800";
  return "text-slate-600";
}

function invoiceIdWithItemCount(invoiceId: string, lineCount: number) {
  return `${invoiceId} (${lineCount} ${lineCount === 1 ? "item" : "items"})`;
}

function paymentStatusLabel(entry: LedgerEntry, draft: PaymentRowDraft) {
  const line = paymentLineForDisplay(entry, draft);
  const balance = getLedgerOutstandingBalance(line);
  if (balance >= 0) return "Paid in full";
  return Number(line.payment_amount) > 0 || line.expense ? "Partial payment" : "Unpaid";
}

function outstandingBeforeExpense(entry: LedgerEntry, draft: PaymentRowDraft) {
  return getLedgerOutstandingBalance({
    ...entryFromDraft(entry, draft),
    expense: false,
    expense_amount: 0,
  });
}

function clientLabel(entry: LedgerEntry, clientNames: Map<string, string>) {
  return entry.clients?.name ?? clientNames.get(entry.client_id) ?? "Unknown client";
}

const defaultPaymentType: PaymentType = "Cash";
const defaultPaidTo: Purchaser = "Jess";

function defaultPaymentAmount(entry: LedgerEntry) {
  const saved = Number(entry.payment_amount);
  if (saved > 0) return saved;
  return ledgerLineAmount(entry);
}

function draftDatePaidFromEntry(entry: LedgerEntry): string {
  const saved = toDateInputValue(entry.date_paid);
  if (saved) return saved;
  if (Number(entry.payment_amount) > 0) return "";
  return todayDateInputValue();
}

function paymentDraftFromEntry(entry: LedgerEntry): PaymentRowDraft {
  const paymentAmount = defaultPaymentAmount(entry);
  const paymentType = entry.payment_type ?? defaultPaymentType;
  const savedFee = Number(entry.payment_fee ?? 0);
  const autoFee = calculateAutoPaymentFee(paymentType, paymentAmount);
  const feeManuallyEdited = paymentTypeHasAutoFee(paymentType)
    ? Math.abs(savedFee - autoFee) > 0.009
    : savedFee > 0;

  return {
    selected: false,
    editing: false,
    date_paid: draftDatePaidFromEntry(entry),
    paid_to: entry.paid_to ?? defaultPaidTo,
    payment_type: paymentType,
    payment_amount: paymentAmount,
    payment_fee: savedFee,
    payment_fee_manually_edited: feeManuallyEdited,
    expense: entry.expense ?? false,
    expense_amount: Number(entry.expense_amount ?? 0),
  };
}

function beginEditingPayment(entry: LedgerEntry): Partial<PaymentRowDraft> {
  const savedDate = toDateInputValue(entry.date_paid);
  return {
    editing: true,
    ...(savedDate ? { date_paid: savedDate } : {}),
  };
}

function paymentFeeHint(paymentType: PaymentType) {
  if (paymentType === "Venmo") {
    return "2.3% of payment amount. Edit to override.";
  }
  if (paymentType === "CC") {
    return "2.6% of payment amount. Edit to override.";
  }
  return undefined;
}

function parsePaymentsDbSetupError(message: string) {
  const lower = message.toLowerCase();
  if (!lower.includes("column") && !lower.includes("schema cache")) {
    return { needsDbSetup: false, needsExpenseSetup: false };
  }

  const missingExpense = lower.includes("expense");
  const missingPayment =
    lower.includes("paid") ||
    lower.includes("payment_amount") ||
    lower.includes("payment_fee") ||
    lower.includes("payment_type");

  return {
    needsDbSetup: missingPayment || !missingExpense,
    needsExpenseSetup: missingExpense,
  };
}

export default function PaymentsPage() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [paidEntries, setPaidEntries] = useState<LedgerEntry[]>([]);
  const [invoicedDebits, setInvoicedDebits] = useState<LedgerEntry[]>([]);
  const [view, setView] = useState<PaymentView>("outstanding");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [historyClientId, setHistoryClientId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, PaymentRowDraft>>({});
  const [needsDbSetup, setNeedsDbSetup] = useState(false);
  const [needsExpenseSetup, setNeedsExpenseSetup] = useState(false);
  const [emptyHint, setEmptyHint] = useState<string | null>(null);
  const [clientNames, setClientNames] = useState<Map<string, string>>(new Map());
  const [expenseModal, setExpenseModal] = useState<{
    entryId: string;
    outstanding: number;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsDbSetup(false);
    setNeedsExpenseSetup(false);
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
      if (setup.needsExpenseSetup) setNeedsExpenseSetup(true);
      setError(message);
      setEntries([]);
      setPaidEntries([]);
      setInvoicedDebits([]);
      setEmptyHint(null);
      setLoading(false);
      return;
    }

    const allInvoiced = (data ?? []).map((row) =>
      normalizeLedgerRow(row as LedgerDbRow & Record<string, unknown>)
    );
    const allInvoicedDebits = allInvoiced.filter(
      (entry) =>
        entry.credit_debit === "debit" && isLedgerLineInvoiced(entry)
    );
    const unpaidDebits = allInvoicedDebits.filter(
      (entry) => !isLedgerLineFullyPaid(entry)
    );
    const paymentHistory = allInvoicedDebits.filter(
      (entry) => ledgerLineAmountSettled(entry) > 0
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
    setPaidEntries(paymentHistory);
    setInvoicedDebits(allInvoicedDebits);

    setDrafts(() => {
      const next: Record<string, PaymentRowDraft> = {};
      for (const entry of [...unpaidDebits, ...paymentHistory]) {
        next[entry.id] = paymentDraftFromEntry(entry);
      }
      return next;
    });

    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const clientsWithPaid = useMemo(() => {
    const byId = new Map<string, string>();
    for (const entry of paidEntries) {
      if (!entry.client_id) continue;
      byId.set(entry.client_id, clientLabel(entry, clientNames));
    }
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [paidEntries, clientNames]);

  const filteredInvoicedDebits = useMemo(() => {
    return historyClientId
      ? invoicedDebits.filter((entry) => entry.client_id === historyClientId)
      : invoicedDebits;
  }, [invoicedDebits, historyClientId]);

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

  const paymentsReceivedTotal = useMemo(
    () => sumPaymentsHistoryTotal(filteredInvoicedDebits),
    [filteredInvoicedDebits]
  );

  const clientsWithUnpaid = useMemo(() => {
    const byId = new Map<string, string>();
    for (const entry of entries) {
      if (!entry.client_id) continue;
      byId.set(entry.client_id, clientLabel(entry, clientNames));
    }
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, clientNames]);

  const soleOutstandingInvoiceClientId = useMemo(() => {
    const invoiceToClient = new Map<string, string>();
    for (const entry of entries) {
      const invoiceId = normalizeInvoiceId(entry.invoice_id);
      if (!invoiceId || !entry.client_id) continue;
      const existingClientId = invoiceToClient.get(invoiceId);
      if (existingClientId && existingClientId !== entry.client_id) {
        return null;
      }
      invoiceToClient.set(invoiceId, entry.client_id);
    }
    if (invoiceToClient.size !== 1) return null;
    return [...invoiceToClient.values()][0];
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const rows = selectedClientId
      ? entries.filter((entry) => entry.client_id === selectedClientId)
      : entries;
    return [...rows].sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  }, [entries, selectedClientId]);

  const allClientInvoicedDebits = useMemo(() => {
    if (selectedClientId) {
      return invoicedDebits.filter((entry) => entry.client_id === selectedClientId);
    }
    return entries;
  }, [invoicedDebits, entries, selectedClientId]);

  const clientInvoiceSummaries = useMemo(
    () =>
      summarizePaymentsByInvoiceId(allClientInvoicedDebits, (entry) => {
        const draft = drafts[entry.id];
        if (draft?.editing) return entryFromDraft(entry, draft);
        return entry;
      }),
    [allClientInvoicedDebits, drafts]
  );

  const clientInvoiceTotals = useMemo(
    () => ({
      invoiced: roundMoney(
        clientInvoiceSummaries.reduce((sum, row) => sum + row.invoicedTotal, 0)
      ),
      paid: roundMoney(
        clientInvoiceSummaries.reduce((sum, row) => sum + row.paidTotal, 0)
      ),
      outstanding: roundMoney(
        clientInvoiceSummaries.reduce((sum, row) => sum + row.outstandingTotal, 0)
      ),
    }),
    [clientInvoiceSummaries]
  );

  useEffect(() => {
    if (loading || view !== "outstanding" || !soleOutstandingInvoiceClientId) return;
    setSelectedClientId((current) => current || soleOutstandingInvoiceClientId);
  }, [loading, view, soleOutstandingInvoiceClientId]);

  useEffect(() => {
    if (
      selectedClientId &&
      !clientsWithUnpaid.some((client) => client.id === selectedClientId)
    ) {
      setSelectedClientId("");
    }
  }, [clientsWithUnpaid, selectedClientId]);

  useEffect(() => {
    if (
      historyClientId &&
      !clientsWithPaid.some((client) => client.id === historyClientId)
    ) {
      setHistoryClientId("");
    }
  }, [clientsWithPaid, historyClientId]);

  const selectedEntries = useMemo(
    () => filteredEntries.filter((entry) => drafts[entry.id]?.selected),
    [filteredEntries, drafts]
  );

  const totalPaymentAmount = useMemo(
    () =>
      roundMoney(
        selectedEntries.reduce((sum, entry) => {
          const draft = drafts[entry.id];
          if (!draft) return sum;
          return sum + paymentReceivedForDraft(entry, draft);
        }, 0)
      ),
    [selectedEntries, drafts]
  );

  const selectedHistoryEntries = useMemo(
    () => filteredPaidEntries.filter((entry) => drafts[entry.id]?.selected),
    [filteredPaidEntries, drafts]
  );

  const totalHistoryPaymentAmount = useMemo(
    () =>
      roundMoney(
        selectedHistoryEntries.reduce((sum, entry) => {
          const draft = drafts[entry.id];
          if (!draft) return sum;
          return sum + paymentReceivedForDraft(entry, draft);
        }, 0)
      ),
    [selectedHistoryEntries, drafts]
  );

  function resetDraftFromEntry(entry: LedgerEntry) {
    updateDraft(entry.id, paymentDraftFromEntry(entry));
  }

  function updateDraft(entryId: string, patch: Partial<PaymentRowDraft>) {
    setDrafts((current) => {
      const existing = current[entryId];
      if (!existing) return current;

      const next: PaymentRowDraft = { ...existing, ...patch };

      if (
        patch.payment_type !== undefined &&
        patch.payment_type !== existing.payment_type
      ) {
        next.payment_fee_manually_edited = false;
      }

      if (!next.payment_fee_manually_edited) {
        if (paymentTypeHasAutoFee(next.payment_type)) {
          if (
            patch.payment_type !== undefined ||
            patch.payment_amount !== undefined
          ) {
            next.payment_fee = calculateAutoPaymentFee(
              next.payment_type,
              next.payment_amount
            );
          }
        } else if (patch.payment_type !== undefined) {
          next.payment_fee = 0;
        }
      }

      return { ...current, [entryId]: next };
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

    const today = todayDateInputValue();
    const target =
      filteredEntries.find((entry) => !drafts[entry.id]?.selected) ?? filteredEntries[0];
    const balance = getLedgerOutstandingBalance(target);
    const amountOwed = balance < 0 ? roundMoney(-balance) : 0;
    const targetDatePaid = toDateInputValue(target.date_paid) || today;

    setDrafts((current) => {
      const next = { ...current };
      for (const entry of filteredEntries) {
        next[entry.id] = {
          ...(next[entry.id] ?? {
            selected: false,
            editing: false,
            date_paid: draftDatePaidFromEntry(entry),
            paid_to: defaultPaidTo,
            payment_type: defaultPaymentType,
            payment_amount: 0,
            payment_fee: 0,
            payment_fee_manually_edited: false,
            expense: false,
            expense_amount: 0,
          }),
          selected: entry.id === target.id,
          editing: entry.id === target.id,
        };
      }
      next[target.id] = {
        ...next[target.id],
        selected: true,
        editing: true,
        date_paid: targetDatePaid,
        paid_to: defaultPaidTo,
        payment_type: defaultPaymentType,
        payment_amount: amountOwed,
        payment_fee: 0,
        payment_fee_manually_edited: false,
        expense: false,
        expense_amount: 0,
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
      updateDraft(entry.id, beginEditingPayment(entry));
    }
  }

  async function handleDeleteSelected() {
    if (selectedEntries.length === 0) {
      setError("Select at least one item to delete.");
      return;
    }
    if (!confirm(`Clear payment and expense for ${selectedEntries.length} item(s)?`)) return;

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
          expense: false,
          expense_amount: 0,
        })
        .eq("id", entry.id);

      if (updateError) {
        setSaving(false);
        const setup = parsePaymentsDbSetupError(updateError.message);
        if (setup.needsDbSetup) setNeedsDbSetup(true);
        if (setup.needsExpenseSetup) setNeedsExpenseSetup(true);
        setError(updateError.message);
        return;
      }
    }

    setSaving(false);
    setSuccess(`Cleared ${selectedEntries.length} item${selectedEntries.length === 1 ? "" : "s"}.`);
    await loadData();
  }

  function handleExpenseToggle(entry: LedgerEntry, draft: PaymentRowDraft, checked: boolean) {
    if (!checked) {
      updateDraft(entry.id, { expense: false, expense_amount: 0 });
      return;
    }

    const balance = outstandingBeforeExpense(entry, draft);
    if (balance === 0) {
      setError("Nothing outstanding to record as expense.");
      return;
    }

    updateDraft(entry.id, { selected: true, ...beginEditingPayment(entry) });
    setExpenseModal({ entryId: entry.id, outstanding: roundMoney(Math.abs(balance)) });
  }

  function handleEditHistorySelected() {
    setError(null);
    if (selectedHistoryEntries.length === 0) {
      setError("Select at least one payment to edit.");
      return;
    }
    for (const entry of selectedHistoryEntries) {
      updateDraft(entry.id, beginEditingPayment(entry));
    }
  }

  function cancelHistoryEdit() {
    setError(null);
    for (const entry of filteredPaidEntries) {
      if (drafts[entry.id]?.editing) {
        resetDraftFromEntry(entry);
      }
    }
  }

  async function savePaymentDrafts(
    rows: { entry: LedgerEntry; draft: PaymentRowDraft }[]
  ): Promise<boolean> {
    setSaving(true);
    const supabase = createClient();

    for (const { entry, draft } of rows) {
      const projected = entryFromDraft(entry, draft);
      const paymentAmount = projected.payment_amount;
      const expenseAmount = projected.expense_amount;
      const hasExpense = projected.expense;

      if (hasExpense) {
        const outstanding = outstandingBeforeExpense(entry, draft);
        if (expenseAmount > outstanding) {
          setSaving(false);
          setError("The expense amount must be less than the outstanding amount.");
          return false;
        }
      }

      const fullyPaid = deriveLedgerPaidFlag(projected);
      const { error: updateError } = await supabase
        .from("ledger")
        .update({
          paid: fullyPaid,
          date_paid:
            paymentAmount > 0 || hasExpense ? draft.date_paid || null : null,
          paid_to: draft.paid_to,
          payment_type: draft.payment_type,
          payment_amount: paymentAmount,
          payment_fee: projected.payment_fee,
          expense: hasExpense,
          expense_amount: hasExpense ? expenseAmount : 0,
        })
        .eq("id", entry.id);

      if (updateError) {
        setSaving(false);
        const setup = parsePaymentsDbSetupError(updateError.message);
        if (setup.needsDbSetup) setNeedsDbSetup(true);
        if (setup.needsExpenseSetup) setNeedsExpenseSetup(true);
        setError(updateError.message);
        return false;
      }
    }

    setSaving(false);
    return true;
  }

  async function submitHistoryUpdates() {
    setSuccess(null);
    setError(null);
    const rows = selectedHistoryEntries
      .map((entry) => ({ entry, draft: drafts[entry.id] }))
      .filter((row) => row.draft);

    if (rows.length === 0) {
      setError("Select at least one payment, then click Edit.");
      return;
    }

    const notEditing = rows.filter(({ draft }) => !draft.editing);
    if (notEditing.length > 0) {
      setError("Click Edit on selected payments before saving.");
      return;
    }

    const ok = await savePaymentDrafts(rows);
    if (!ok) return;

    setSuccess(`Updated ${rows.length} payment${rows.length === 1 ? "" : "s"}.`);
    await loadData();
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

    const ok = await savePaymentDrafts(rows);
    if (!ok) return;

    setSuccess(`Updated ${rows.length} item${rows.length === 1 ? "" : "s"}.`);
    await loadData();
  }

  return (
    <AppShell>
      <PageHeader
        title="Payments"
        description="Record payments against invoiced amounts. Items stay open until payment equals invoiced amount."
      />

      {(needsExpenseSetup || needsDbSetup) && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Database setup required for Payments</p>
          {needsExpenseSetup && (
            <>
              <p className="mt-2">
                Expense tracking uses <code className="rounded bg-amber-100 px-1">expense</code> and{" "}
                <code className="rounded bg-amber-100 px-1">expense_amount</code> on the ledger
                table. Run this in Supabase SQL Editor, then refresh:
              </p>
              <pre className="mt-3 overflow-x-auto rounded-md border border-amber-200 bg-white p-3 text-xs text-slate-800">
                {EXPENSE_DB_SETUP_SQL}
              </pre>
            </>
          )}
          {needsDbSetup && !needsExpenseSetup && (
            <>
              <p className="mt-2">
                Run the SQL below in Supabase SQL Editor, then refresh this page.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-md border border-amber-200 bg-white p-3 text-xs text-slate-800">
                {PAYMENTS_DB_SETUP_SQL}
              </pre>
            </>
          )}
          {needsDbSetup && needsExpenseSetup && (
            <p className="mt-3 text-xs text-amber-900">
              If payment columns are already set up, only the expense SQL above is required.
            </p>
          )}
        </div>
      )}

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
              <option value="">All clients</option>
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
            Leave blank to view all outstanding payments, or select a client to filter.
            Choose a client to add or edit payments.
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
      ) : (
        <>
      {filteredEntries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          {selectedClientId
            ? "No unpaid debit items for this client."
            : "No outstanding payment balances."}
        </div>
      ) : (
        <>
        <div className="mb-2">
          <h2 className="text-sm font-semibold text-slate-900">
            {selectedClientId ? "Unpaid items" : "Outstanding payments (all clients)"}
          </h2>
          <p className="text-xs text-slate-500">
            {selectedClientId
              ? "Select items below, then use Edit, Delete, or Save at the bottom."
              : "All invoiced lines with a balance due. Select a client above to add or edit payments."}
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
                    disabled={!selectedClientId}
                    onChange={(event) =>
                      updateDraft(entry.id, { selected: event.target.checked })
                    }
                    className="mt-1 size-4 rounded border-brand-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50"
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
                      Outstanding:{" "}
                      <span className={outstandingBalanceClass(lineOutstandingBalance(entry, draft))}>
                        {formatCurrency(lineOutstandingBalance(entry, draft))}
                      </span>
                    </p>
                  </div>
                </label>

                <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                  <p className="text-sm text-slate-600">
                    Status:{" "}
                    <span className="font-medium text-slate-900">
                      {paymentStatusLabel(entry, draft)}
                    </span>
                  </p>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Date paid</span>
                    {draft.editing ? (
                      <input
                        type="date"
                        value={draft.date_paid}
                        onChange={(event) =>
                          updateDraft(entry.id, { date_paid: event.target.value })
                        }
                        className={fieldClass}
                      />
                    ) : (
                      <p className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                        {formatDate(entry.date_paid)}
                      </p>
                    )}
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
                      {PAYMENT_TYPE_OPTIONS.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Payment fee</span>
                    {paymentFeeHint(draft.payment_type) && (
                      <span className="mb-1 block text-xs text-slate-500">
                        {paymentFeeHint(draft.payment_type)}
                      </span>
                    )}
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={draft.payment_fee}
                      disabled={!draft.editing}
                      onChange={(event) =>
                        updateDraft(entry.id, {
                          payment_fee: Number(event.target.value) || 0,
                          payment_fee_manually_edited: true,
                        })
                      }
                      className={fieldClass}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.expense}
                      disabled={!draft.editing}
                      onChange={(event) =>
                        handleExpenseToggle(entry, draft, event.target.checked)
                      }
                      className="size-4 rounded border-brand-300 text-brand-600 focus:ring-brand-500 disabled:border-slate-300 disabled:opacity-50"
                    />
                    <span className="text-slate-700">Expense</span>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Expense amount</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={draft.expense_amount}
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
                <th className="px-3 py-3">Expense</th>
                <th className="px-3 py-3">Expense Amount</th>
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
                        disabled={!selectedClientId}
                        onChange={(event) =>
                          updateDraft(entry.id, { selected: event.target.checked })
                        }
                        className="size-4 rounded border-brand-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50"
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
                    <td
                      className={`px-3 py-3 font-medium ${outstandingBalanceClass(lineOutstandingBalance(entry, draft))}`}
                    >
                      {formatCurrency(lineOutstandingBalance(entry, draft))}
                    </td>
                    <td className="px-3 py-3">
                      {paymentStatusLabel(entry, draft)}
                    </td>
                    <td className="px-3 py-3">
                      {draft.editing ? (
                        <input
                          type="date"
                          value={draft.date_paid}
                          onChange={(event) =>
                            updateDraft(entry.id, { date_paid: event.target.value })
                          }
                          className={`min-h-10 px-2 text-sm ${editableControlClass}`}
                        />
                      ) : (
                        formatDate(entry.date_paid)
                      )}
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
                        {PAYMENT_TYPE_OPTIONS.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
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
                            payment_fee_manually_edited: true,
                          })
                        }
                        className={`min-h-10 w-24 px-2 text-sm ${editableControlClass}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={draft.expense}
                        disabled={!draft.editing}
                        onChange={(event) =>
                          handleExpenseToggle(entry, draft, event.target.checked)
                        }
                        className="size-4 rounded border-brand-300 text-brand-600 focus:ring-brand-500 disabled:border-slate-300 disabled:opacity-50"
                      />
                    </td>
                    <td className="px-3 py-3">
                      {draft.expense
                        ? formatCurrency(draft.expense_amount)
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

        {selectedClientId && clientInvoiceSummaries.length > 0 && (
        <div className="mb-4 mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Totals by invoice ID</h2>
          <p className="mt-1 text-xs text-slate-500">
            Combined invoiced, paid, and outstanding (invoiced − paid) for each invoice.
          </p>
          <div className="mt-3 space-y-3 md:hidden">
            {clientInvoiceSummaries.map((summary) => (
              <div
                key={summary.invoiceId}
                className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm"
              >
                <p className="font-medium text-slate-900">
                  {invoiceIdWithItemCount(summary.invoiceId, summary.lineCount)}
                </p>
                <dl className="mt-2 grid grid-cols-3 gap-2">
                  <div>
                    <dt className="text-slate-500">Invoiced</dt>
                    <dd className="font-medium">{formatCurrency(summary.invoicedTotal)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Paid</dt>
                    <dd className="font-medium text-brand-800">
                      {formatCurrency(summary.paidTotal)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Outstanding</dt>
                    <dd className={`font-medium ${outstandingBalanceClass(summary.outstandingTotal)}`}>
                      {formatCurrency(summary.outstandingTotal)}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
            <div className="rounded-lg border border-slate-200 bg-white p-3 font-semibold text-slate-900">
              <p>Total</p>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="font-normal text-slate-500">Invoiced</dt>
                  <dd>{formatCurrency(clientInvoiceTotals.invoiced)}</dd>
                </div>
                <div>
                  <dt className="font-normal text-slate-500">Paid</dt>
                  <dd className="text-brand-800">{formatCurrency(clientInvoiceTotals.paid)}</dd>
                </div>
                <div>
                  <dt className="font-normal text-slate-500">Outstanding</dt>
                  <dd className={outstandingBalanceClass(clientInvoiceTotals.outstanding)}>
                    {formatCurrency(clientInvoiceTotals.outstanding)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-500">
                  <th className="py-2 pr-4">Invoice ID</th>
                  <th className="py-2 pr-4 text-right">Invoiced</th>
                  <th className="py-2 pr-4 text-right">Paid</th>
                  <th className="py-2 pr-4 text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {clientInvoiceSummaries.map((summary) => (
                  <tr key={summary.invoiceId} className="border-b border-slate-50">
                    <td className="py-3 pr-4 font-medium text-slate-900">
                      {invoiceIdWithItemCount(summary.invoiceId, summary.lineCount)}
                    </td>
                    <td className="py-3 pr-4 text-right">{formatCurrency(summary.invoicedTotal)}</td>
                    <td className="py-3 pr-4 text-right font-medium text-brand-800">
                      {formatCurrency(summary.paidTotal)}
                    </td>
                    <td
                      className={`py-3 pr-4 text-right font-medium ${outstandingBalanceClass(summary.outstandingTotal)}`}
                    >
                      {formatCurrency(summary.outstandingTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold text-slate-900">
                  <td className="py-3 pr-4">Total</td>
                  <td className="py-3 pr-4 text-right">
                    {formatCurrency(clientInvoiceTotals.invoiced)}
                  </td>
                  <td className="py-3 pr-4 text-right text-brand-800">
                    {formatCurrency(clientInvoiceTotals.paid)}
                  </td>
                  <td
                    className={`py-3 pr-4 text-right ${outstandingBalanceClass(clientInvoiceTotals.outstanding)}`}
                  >
                    {formatCurrency(clientInvoiceTotals.outstanding)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
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

          {!loading && (
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {historyClientId ? "Payments Received (filtered)" : "Payments Received"}
              </p>
              <p className="mt-1 text-xl font-semibold text-brand-800">
                {formatCurrency(paymentsReceivedTotal)}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Invoiced amount collected; partial payments count. Matches Reconciliation.
              </p>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-slate-500">Loading payment history...</p>
          ) : filteredPaidEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              <p>No payments received yet.</p>
            </div>
          ) : (
            <>
            <p className="mb-3 text-xs text-slate-500">
              Select payments below, click Edit, make changes, then Save.
            </p>
            <div className="space-y-3 md:hidden">
              {filteredPaidEntries.map((entry) => {
                const draft = drafts[entry.id];
                if (!draft) return null;

                return (
                  <article
                    key={entry.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm text-sm"
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
                        <p className="font-medium text-slate-900">
                          {entry.clients?.name ?? clientNames.get(entry.client_id) ?? "—"}
                        </p>
                        <p className="text-slate-500">
                          {formatDate(entry.date_paid)} · {entry.invoice_id ?? "—"}
                        </p>
                        <p className="mt-1 text-slate-700">{entry.description || "—"}</p>
                        <p className="mt-1 font-medium text-brand-800">
                          Payment amount: {formatCurrency(paymentAmountForLine(entry, draft))}
                        </p>
                        {paymentsReceivedForLine(entry, draft) !==
                          paymentAmountForLine(entry, draft) && (
                          <p className="text-sm text-slate-600">
                            Payments received (invoiced):{" "}
                            {formatCurrency(paymentsReceivedForLine(entry, draft))}
                          </p>
                        )}
                        <p className="text-sm text-slate-600">
                          {isLedgerLineFullyPaid(entryFromDraft(entry, draft))
                            ? "Paid in full"
                            : "Partial payment"}
                        </p>
                      </div>
                    </label>

                    {draft.editing && (
                      <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                        <label className="block text-sm">
                          <span className="mb-1 block text-slate-600">Date paid</span>
                          <input
                            type="date"
                            value={draft.date_paid}
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
                            onChange={(event) =>
                              updateDraft(entry.id, {
                                paid_to: event.target.value as Purchaser,
                              })
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
                            onChange={(event) =>
                              updateDraft(entry.id, {
                                payment_type: event.target.value as PaymentType,
                              })
                            }
                          >
                            {PAYMENT_TYPE_OPTIONS.map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-slate-600">Payment fee</span>
                          {paymentFeeHint(draft.payment_type) && (
                            <span className="mb-1 block text-xs text-slate-500">
                              {paymentFeeHint(draft.payment_type)}
                            </span>
                          )}
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={draft.payment_fee}
                            onChange={(event) =>
                              updateDraft(entry.id, {
                                payment_fee: Number(event.target.value) || 0,
                                payment_fee_manually_edited: true,
                              })
                            }
                            className={fieldClass}
                          />
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={draft.expense}
                            onChange={(event) =>
                              handleExpenseToggle(entry, draft, event.target.checked)
                            }
                            className="size-4 rounded border-brand-300 text-brand-600 focus:ring-brand-500"
                          />
                          <span className="text-slate-700">Expense</span>
                        </label>
                        {draft.expense && (
                          <p className="text-sm text-slate-600">
                            Expense amount: {formatCurrency(draft.expense_amount)}
                          </p>
                        )}
                      </div>
                    )}
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
                    <th className="px-3 py-3">Date Paid</th>
                    <th className="px-3 py-3">Invoice ID</th>
                    <th className="px-3 py-3">Description</th>
                    <th className="px-3 py-3">Payment Amount</th>
                    <th className="px-3 py-3">Payments Received</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Paid To</th>
                    <th className="px-3 py-3">Payment Type</th>
                    <th className="px-3 py-3">Payment Fee</th>
                    <th className="px-3 py-3">Expense</th>
                    <th className="px-3 py-3">Expense Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPaidEntries.map((entry) => {
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
                        <td className="px-3 py-3">
                          {draft.editing ? (
                            <input
                              type="date"
                              value={draft.date_paid}
                              onChange={(event) =>
                                updateDraft(entry.id, { date_paid: event.target.value })
                              }
                              className={`min-h-10 px-2 text-sm ${editableControlClass}`}
                            />
                          ) : (
                            formatDate(entry.date_paid)
                          )}
                        </td>
                        <td className="px-3 py-3">{entry.invoice_id ?? "—"}</td>
                        <td className="px-3 py-3">{entry.description || "—"}</td>
                        <td className="px-3 py-3 font-medium text-brand-800">
                          {draft.editing ? (
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={draft.payment_amount}
                              onChange={(event) =>
                                updateDraft(entry.id, {
                                  payment_amount: Number(event.target.value) || 0,
                                })
                              }
                              className={`min-h-10 w-28 px-2 text-sm ${editableControlClass}`}
                            />
                          ) : (
                            formatCurrency(paymentAmountForLine(entry, draft))
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-700">
                          {formatCurrency(paymentsReceivedForLine(entry, draft))}
                        </td>
                        <td className="px-3 py-3">
                          {isLedgerLineFullyPaid(entryFromDraft(entry, draft))
                            ? "Paid in full"
                            : "Partial"}
                        </td>
                        <td className="px-3 py-3">
                          {draft.editing ? (
                            <select
                              className={`min-h-10 min-w-28 cursor-pointer appearance-none bg-white bg-[length:1rem] bg-[right_0.5rem_center] bg-no-repeat px-2 py-2 pr-8 text-sm ${selectChevron} ${editableControlClass}`}
                              value={draft.paid_to}
                              onChange={(event) =>
                                updateDraft(entry.id, {
                                  paid_to: event.target.value as Purchaser,
                                })
                              }
                            >
                              <option value="Jess">Jess</option>
                              <option value="Molly">Molly</option>
                            </select>
                          ) : (
                            (entry.paid_to ?? "—")
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {draft.editing ? (
                            <select
                              className={`min-h-10 min-w-28 cursor-pointer appearance-none bg-white bg-[length:1rem] bg-[right_0.5rem_center] bg-no-repeat px-2 py-2 pr-8 text-sm ${selectChevron} ${editableControlClass}`}
                              value={draft.payment_type}
                              onChange={(event) =>
                                updateDraft(entry.id, {
                                  payment_type: event.target.value as PaymentType,
                                })
                              }
                            >
                              {PAYMENT_TYPE_OPTIONS.map((type) => (
                                <option key={type} value={type}>
                                  {type}
                                </option>
                              ))}
                            </select>
                          ) : (
                            (entry.payment_type ?? "—")
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {draft.editing ? (
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={draft.payment_fee}
                              onChange={(event) =>
                                updateDraft(entry.id, {
                                  payment_fee: Number(event.target.value) || 0,
                                  payment_fee_manually_edited: true,
                                })
                              }
                              className={`min-h-10 w-24 px-2 text-sm ${editableControlClass}`}
                            />
                          ) : (
                            formatCurrency(Number(entry.payment_fee ?? 0))
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {draft.editing ? (
                            <input
                              type="checkbox"
                              checked={draft.expense}
                              onChange={(event) =>
                                handleExpenseToggle(entry, draft, event.target.checked)
                              }
                              className="size-4 rounded border-brand-300 text-brand-600 focus:ring-brand-500"
                            />
                          ) : (
                            (entry.expense ? "Yes" : "No")
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {formatCurrency(
                            draft.expense ? draft.expense_amount : Number(entry.expense_amount ?? 0)
                          )}
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
                  Selected payment total
                </p>
                <p className="text-xl font-semibold text-brand-800">
                  {formatCurrency(totalHistoryPaymentAmount)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={handleEditHistorySelected}>
                  Edit
                </Button>
                <Button type="button" variant="secondary" onClick={cancelHistoryEdit}>
                  Cancel
                </Button>
                <Button type="button" loading={saving} onClick={submitHistoryUpdates}>
                  Save
                </Button>
              </div>
            </div>
            </>
          )}
        </>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {success && <p className="mt-3 text-sm text-brand-700">{success}</p>}

      {expenseModal && (
        <ExpenseModal
          outstanding={expenseModal.outstanding}
          onConfirm={(amount) => {
            const entry = entries.find((row) => row.id === expenseModal.entryId);
            updateDraft(expenseModal.entryId, {
              expense: true,
              expense_amount: amount,
              selected: true,
              ...(entry ? beginEditingPayment(entry) : { editing: true }),
            });
            setExpenseModal(null);
          }}
          onCancel={() => setExpenseModal(null)}
        />
      )}
    </AppShell>
  );
}
