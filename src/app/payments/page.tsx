"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { VarianceAcceptModal } from "@/components/payments/VarianceAcceptModal";
import { Button } from "@/components/ui/Button";
import { SelectField, editableControlClass, fieldClass, selectChevron, selectFieldClass } from "@/components/ui/FormFields";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/client";
import {
  getLedgerOutstandingBalance,
  getLedgerSettlementPaymentAmount,
  getLedgerUnderpaymentAmount,
  getLedgerVarianceBeforeAcceptance,
  isLedgerLineFullyPaid,
  deriveLedgerPaidFlag,
  isLedgerLineInvoiced,
  ledgerLineAmount,
  ledgerLineAmountSettled,
  summarizePaymentsByInvoiceId,
  normalizeInvoiceId,
  normalizePoNumber,
} from "@/lib/invoice-utils";
import { normalizeLedgerRow, PAYMENTS_DB_SETUP_SQL, EXPENSE_DB_SETUP_SQL, LEDGER_VARIANCE_SETUP_SQL, VARIANCE_NOTES_MAX_LENGTH, type LedgerDbRow } from "@/lib/ledger-db";
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
  getLedgerInvoicedAmountExcludingPaymentFee,
  paymentTypeHasAutoFee,
  roundMoney,
  toDateInputValue,
  todayDateInputValue,
} from "@/lib/utils";

type PaymentView = "outstanding" | "history";

type PaymentRowDraft = {
  editing: boolean;
  date_paid: string;
  paid_to: Purchaser;
  payment_type: PaymentType;
  payment_amount: number;
  payment_fee: number;
  payment_fee_manually_edited: boolean;
  expense: boolean;
  expense_amount: number;
  variance_accepted: boolean;
  variance_amount: number;
  variance_notes: string;
};

type VariancePromptItem = {
  entryId: string;
  amount: number;
  clientName: string;
  description: string;
  existingNotes: string;
};

type VarianceDecision = {
  accepted: boolean;
  notes: string;
};

type PendingPaymentSave = {
  rows: { entry: LedgerEntry; draft: PaymentRowDraft }[];
  prompts: VariancePromptItem[];
  promptIndex: number;
  decisions: Record<string, VarianceDecision>;
  successMessage: string;
};

function entryFromDraft(entry: LedgerEntry, draft: PaymentRowDraft): LedgerEntry {
  const varianceAmount = roundMoney(Number(draft.variance_amount) || 0);
  const hasVariance =
    draft.variance_accepted || Math.abs(varianceAmount) >= 0.005;
  const notes = (draft.variance_notes ?? "").trim().slice(0, VARIANCE_NOTES_MAX_LENGTH);
  return {
    ...entry,
    payment_amount: roundMoney(Number(draft.payment_amount) || 0),
    payment_fee: Number(draft.payment_fee) || 0,
    expense: false,
    expense_amount: 0,
    variance_accepted: hasVariance,
    variance_amount: hasVariance ? varianceAmount : 0,
    variance_notes: hasVariance ? notes : "",
  };
}

function paymentLineForDisplay(entry: LedgerEntry, draft: PaymentRowDraft) {
  return draft.editing ? entryFromDraft(entry, draft) : entry;
}

function lineOutstandingBalance(entry: LedgerEntry, draft: PaymentRowDraft) {
  return getLedgerUnderpaymentAmount(entryFromDraft(entry, draft));
}

function paymentReceivedForDraft(entry: LedgerEntry, draft: PaymentRowDraft) {
  return getLedgerSettlementPaymentAmount(entryFromDraft(entry, draft));
}

function paymentAmountForLine(entry: LedgerEntry, draft: PaymentRowDraft) {
  return getLedgerSettlementPaymentAmount(entryFromDraft(entry, draft));
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
  if (balance === 0) return "Paid in full";
  return Number(line.payment_amount) > 0 || line.expense || line.variance_accepted
    ? "Partial payment"
    : "Unpaid";
}

function varianceAmountForDisplay(entry: LedgerEntry, draft: PaymentRowDraft) {
  // Always use live signed variance: positive = overpayment, negative = underpayment.
  // Avoids stale DB signs from before the convention flip.
  return getLedgerVarianceBeforeAcceptance(
    entryFromDraft(entry, {
      ...draft,
      variance_accepted: false,
      variance_amount: 0,
      variance_notes: "",
    })
  );
}

function clientLabel(entry: LedgerEntry, clientNames: Map<string, string>) {
  return entry.clients?.name ?? clientNames.get(entry.client_id) ?? "Unknown client";
}

function entryMatchesPaymentFilters(
  entry: LedgerEntry,
  filters: { clientId: string; po: string; invoiceId: string }
) {
  if (filters.clientId && entry.client_id !== filters.clientId) return false;
  if (
    filters.po &&
    normalizePoNumber(entry.po_number) !== normalizePoNumber(filters.po)
  ) {
    return false;
  }
  if (filters.invoiceId) {
    const invoiceId = normalizeInvoiceId(entry.invoice_id).toLowerCase();
    if (invoiceId !== normalizeInvoiceId(filters.invoiceId).toLowerCase()) {
      return false;
    }
  }
  return true;
}

const paymentsStickyHeaderClass =
  "sticky top-0 z-20 bg-slate-50 px-3 py-3 shadow-[0_1px_0_0_rgb(226,232,240)]";
const paymentsTableScrollClass =
  "hidden max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block";

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
    editing: false,
    date_paid: draftDatePaidFromEntry(entry),
    paid_to: entry.paid_to ?? defaultPaidTo,
    payment_type: paymentType,
    payment_amount: paymentAmount,
    payment_fee: savedFee,
    payment_fee_manually_edited: feeManuallyEdited,
    expense: entry.expense ?? false,
    expense_amount: Number(entry.expense_amount ?? 0),
    variance_accepted: entry.variance_accepted ?? false,
    variance_amount: Number(entry.variance_amount ?? 0),
    variance_notes: entry.variance_notes ?? "",
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
    return { needsDbSetup: false, needsExpenseSetup: false, needsVarianceSetup: false };
  }

  const missingVariance = lower.includes("variance");
  const missingExpense = lower.includes("expense");
  const missingPayment =
    lower.includes("paid") ||
    lower.includes("payment_amount") ||
    lower.includes("payment_fee") ||
    lower.includes("payment_type");

  return {
    needsDbSetup: missingPayment || (!missingExpense && !missingVariance),
    needsExpenseSetup: missingExpense,
    needsVarianceSetup: missingVariance,
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
  const [filterPo, setFilterPo] = useState("");
  const [filterInvoiceId, setFilterInvoiceId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, PaymentRowDraft>>({});
  const [needsDbSetup, setNeedsDbSetup] = useState(false);
  const [needsExpenseSetup, setNeedsExpenseSetup] = useState(false);
  const [needsVarianceSetup, setneedsVarianceSetup] = useState(false);
  const [emptyHint, setEmptyHint] = useState<string | null>(null);
  const [clientNames, setClientNames] = useState<Map<string, string>>(new Map());
  const [pendingSave, setPendingSave] = useState<PendingPaymentSave | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsDbSetup(false);
    setNeedsExpenseSetup(false);
    setneedsVarianceSetup(false);
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
      if (setup.needsVarianceSetup) setneedsVarianceSetup(true);
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
    return invoicedDebits.filter((entry) =>
      entryMatchesPaymentFilters(entry, {
        clientId: historyClientId,
        po: filterPo,
        invoiceId: filterInvoiceId,
      })
    );
  }, [invoicedDebits, historyClientId, filterPo, filterInvoiceId]);

  const filteredPaidEntries = useMemo(() => {
    const rows = paidEntries.filter((entry) =>
      entryMatchesPaymentFilters(entry, {
        clientId: historyClientId,
        po: filterPo,
        invoiceId: filterInvoiceId,
      })
    );
    return [...rows].sort((a, b) => {
      const dateA = a.date_paid ?? a.entry_date;
      const dateB = b.date_paid ?? b.entry_date;
      return dateB.localeCompare(dateA);
    });
  }, [paidEntries, historyClientId, filterPo, filterInvoiceId]);

  const paymentsReceivedTotal = useMemo(
    () =>
      roundMoney(
        filteredInvoicedDebits.reduce(
          (sum, entry) => sum + getLedgerSettlementPaymentAmount(entry),
          0
        )
      ),
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

  const outstandingFilterSource = useMemo(() => {
    return selectedClientId
      ? entries.filter((entry) => entry.client_id === selectedClientId)
      : entries;
  }, [entries, selectedClientId]);

  const historyFilterSource = useMemo(() => {
    return historyClientId
      ? paidEntries.filter((entry) => entry.client_id === historyClientId)
      : paidEntries;
  }, [paidEntries, historyClientId]);

  const outstandingPoOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: string[] = [];
    for (const entry of outstandingFilterSource) {
      const po = entry.po_number?.trim();
      if (!po) continue;
      const key = normalizePoNumber(po);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(po);
    }
    return options.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [outstandingFilterSource]);

  const outstandingInvoiceOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: string[] = [];
    for (const entry of outstandingFilterSource) {
      const invoiceId = entry.invoice_id?.trim();
      if (!invoiceId) continue;
      const key = invoiceId.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(invoiceId);
    }
    return options.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [outstandingFilterSource]);

  const historyPoOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: string[] = [];
    for (const entry of historyFilterSource) {
      const po = entry.po_number?.trim();
      if (!po) continue;
      const key = normalizePoNumber(po);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(po);
    }
    return options.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [historyFilterSource]);

  const historyInvoiceOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: string[] = [];
    for (const entry of historyFilterSource) {
      const invoiceId = entry.invoice_id?.trim();
      if (!invoiceId) continue;
      const key = invoiceId.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(invoiceId);
    }
    return options.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [historyFilterSource]);

  const activePoOptions = view === "outstanding" ? outstandingPoOptions : historyPoOptions;
  const activeInvoiceOptions =
    view === "outstanding" ? outstandingInvoiceOptions : historyInvoiceOptions;

  useEffect(() => {
    if (
      filterPo &&
      !activePoOptions.some(
        (po) => normalizePoNumber(po) === normalizePoNumber(filterPo)
      )
    ) {
      setFilterPo("");
    }
    if (
      filterInvoiceId &&
      !activeInvoiceOptions.some(
        (invoiceId) =>
          invoiceId.toLowerCase() === filterInvoiceId.trim().toLowerCase()
      )
    ) {
      setFilterInvoiceId("");
    }
  }, [
    view,
    selectedClientId,
    historyClientId,
    filterPo,
    filterInvoiceId,
    activePoOptions,
    activeInvoiceOptions,
  ]);

  const filteredEntries = useMemo(() => {
    const rows = entries.filter((entry) =>
      entryMatchesPaymentFilters(entry, {
        clientId: selectedClientId,
        po: filterPo,
        invoiceId: filterInvoiceId,
      })
    );
    return [...rows].sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  }, [entries, selectedClientId, filterPo, filterInvoiceId]);

  const allClientInvoicedDebits = useMemo(() => {
    const source = selectedClientId
      ? invoicedDebits.filter((entry) => entry.client_id === selectedClientId)
      : entries;
    return source.filter((entry) =>
      entryMatchesPaymentFilters(entry, {
        clientId: "",
        po: filterPo,
        invoiceId: filterInvoiceId,
      })
    );
  }, [invoicedDebits, entries, selectedClientId, filterPo, filterInvoiceId]);

  const hasActiveFilters = Boolean(filterPo || filterInvoiceId);

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

  const editingEntries = useMemo(
    () => filteredEntries.filter((entry) => drafts[entry.id]?.editing),
    [filteredEntries, drafts]
  );

  const totalPaymentAmount = useMemo(
    () =>
      roundMoney(
        editingEntries.reduce((sum, entry) => {
          const draft = drafts[entry.id];
          if (!draft) return sum;
          return sum + paymentReceivedForDraft(entry, draft);
        }, 0)
      ),
    [editingEntries, drafts]
  );

  const editingHistoryEntries = useMemo(
    () => filteredPaidEntries.filter((entry) => drafts[entry.id]?.editing),
    [filteredPaidEntries, drafts]
  );

  const totalHistoryPaymentAmount = useMemo(
    () =>
      roundMoney(
        editingHistoryEntries.reduce((sum, entry) => {
          const draft = drafts[entry.id];
          if (!draft) return sum;
          return sum + paymentReceivedForDraft(entry, draft);
        }, 0)
      ),
    [editingHistoryEntries, drafts]
  );

  function resetDraftFromEntry(entry: LedgerEntry) {
    updateDraft(entry.id, paymentDraftFromEntry(entry));
  }

  function updateDraft(entryId: string, patch: Partial<PaymentRowDraft>) {
    setDrafts((current) => {
      const existing = current[entryId];
      if (!existing) return current;

      const next: PaymentRowDraft = { ...existing, ...patch };

      const paymentFieldsChanged =
        (patch.payment_amount !== undefined &&
          patch.payment_amount !== existing.payment_amount) ||
        (patch.payment_fee !== undefined &&
          patch.payment_fee !== existing.payment_fee);

      if (
        paymentFieldsChanged &&
        patch.variance_accepted === undefined &&
        patch.variance_amount === undefined &&
        patch.variance_notes === undefined
      ) {
        next.variance_accepted = false;
        next.variance_amount = 0;
        next.variance_notes = "";
      }

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
      filteredEntries.find((entry) => !drafts[entry.id]?.editing) ?? filteredEntries[0];
    const balance = getLedgerOutstandingBalance(target);
    const amountOwed = balance < 0 ? roundMoney(-balance) : 0;
    const targetDatePaid = toDateInputValue(target.date_paid) || today;

    setDrafts((current) => {
      const next = { ...current };
      for (const entry of filteredEntries) {
        next[entry.id] = {
          ...(next[entry.id] ?? {
            editing: false,
            date_paid: draftDatePaidFromEntry(entry),
            paid_to: defaultPaidTo,
            payment_type: defaultPaymentType,
            payment_amount: 0,
            payment_fee: 0,
            payment_fee_manually_edited: false,
            expense: false,
            expense_amount: 0,
            variance_accepted: false,
            variance_amount: 0,
            variance_notes: "",
          }),
          editing: entry.id === target.id,
        };
      }
      next[target.id] = {
        ...next[target.id],
        editing: true,
        date_paid: targetDatePaid,
        paid_to: defaultPaidTo,
        payment_type: defaultPaymentType,
        payment_amount: amountOwed,
        payment_fee: 0,
        payment_fee_manually_edited: false,
        expense: false,
        expense_amount: 0,
        variance_accepted: false,
        variance_amount: 0,
        variance_notes: "",
      };
      return next;
    });
  }

  function beginEditRow(entry: LedgerEntry) {
    setError(null);
    setSuccess(null);
    if (!selectedClientId) {
      setError("Select a client first.");
      return;
    }
    updateDraft(entry.id, beginEditingPayment(entry));
  }

  function beginEditHistoryRow(entry: LedgerEntry) {
    setError(null);
    setSuccess(null);
    updateDraft(entry.id, beginEditingPayment(entry));
  }

  function cancelRowEdit(entry: LedgerEntry) {
    setError(null);
    resetDraftFromEntry(entry);
  }

  async function handleDeleteEditing() {
    if (editingEntries.length === 0) {
      setError("Click Edit on at least one item to clear.");
      return;
    }
    if (!confirm(`Clear payment and variance for ${editingEntries.length} item(s)?`)) return;

    setError(null);
    setSuccess(null);
    setSaving(true);
    const supabase = createClient();

    for (const entry of editingEntries) {
      const { error: updateError } = await supabase
        .from("ledger")
        .update({
          paid: false,
          date_paid: null,
          payment_amount: 0,
          payment_fee: 0,
          expense: false,
          expense_amount: 0,
          variance_accepted: false,
          variance_amount: 0,
          variance_notes: "",
        })
        .eq("id", entry.id);

      if (updateError) {
        setSaving(false);
        const setup = parsePaymentsDbSetupError(updateError.message);
        if (setup.needsDbSetup) setNeedsDbSetup(true);
        if (setup.needsExpenseSetup) setNeedsExpenseSetup(true);
        if (setup.needsVarianceSetup) setneedsVarianceSetup(true);
        setError(updateError.message);
        return;
      }
    }

    setSaving(false);
    setSuccess(`Cleared ${editingEntries.length} item${editingEntries.length === 1 ? "" : "s"}.`);
    await loadData();
  }

  async function persistPaymentDrafts(
    rows: { entry: LedgerEntry; draft: PaymentRowDraft }[],
    decisions: Record<string, VarianceDecision>
  ): Promise<boolean> {
    setSaving(true);
    const supabase = createClient();

    for (const { entry, draft } of rows) {
      const projectedBase = entryFromDraft(entry, {
        ...draft,
        variance_accepted: false,
        variance_amount: 0,
        variance_notes: "",
      });
      const varianceBefore = getLedgerVarianceBeforeAcceptance(projectedBase);
      const decision = decisions[entry.id];
      const acceptVariance =
        decision?.accepted === true && Math.abs(varianceBefore) >= 0.005;
      const varianceNotes = acceptVariance
        ? (decision.notes ?? "").trim().slice(0, VARIANCE_NOTES_MAX_LENGTH)
        : "";
      if (acceptVariance && !varianceNotes) {
        setSaving(false);
        setError("An explanation is required to accept a variance.");
        return false;
      }
      const projected: LedgerEntry = {
        ...projectedBase,
        variance_accepted: acceptVariance,
        variance_amount: acceptVariance ? varianceBefore : 0,
        variance_notes: varianceNotes,
      };

      const paymentAmount = projected.payment_amount;

      const fullyPaid = deriveLedgerPaidFlag(projected);
      const { error: updateError } = await supabase
        .from("ledger")
        .update({
          paid: fullyPaid,
          date_paid:
            paymentAmount > 0 || acceptVariance
              ? draft.date_paid || null
              : null,
          paid_to: draft.paid_to,
          payment_type: draft.payment_type,
          payment_amount: paymentAmount,
          payment_fee: projected.payment_fee,
          expense: false,
          expense_amount: 0,
          variance_accepted: acceptVariance,
          variance_amount: acceptVariance ? varianceBefore : 0,
          variance_notes: varianceNotes,
        })
        .eq("id", entry.id);

      if (updateError) {
        setSaving(false);
        const setup = parsePaymentsDbSetupError(updateError.message);
        if (setup.needsDbSetup) setNeedsDbSetup(true);
        if (setup.needsExpenseSetup) setNeedsExpenseSetup(true);
        if (setup.needsVarianceSetup) setneedsVarianceSetup(true);
        setError(updateError.message);
        return false;
      }
    }

    setSaving(false);
    return true;
  }

  async function finishPendingSave(pending: PendingPaymentSave) {
    const ok = await persistPaymentDrafts(pending.rows, pending.decisions);
    setPendingSave(null);
    if (!ok) return;
    setSuccess(pending.successMessage);
    await loadData();
  }

  function advanceVariancePrompt(
    pending: PendingPaymentSave,
    accepted: boolean,
    notes = ""
  ) {
    const current = pending.prompts[pending.promptIndex];
    const decisions = {
      ...pending.decisions,
      [current.entryId]: {
        accepted,
        notes: accepted ? notes.trim().slice(0, VARIANCE_NOTES_MAX_LENGTH) : "",
      },
    };
    const nextIndex = pending.promptIndex + 1;
    if (nextIndex < pending.prompts.length) {
      setPendingSave({
        ...pending,
        decisions,
        promptIndex: nextIndex,
      });
      return;
    }
    void finishPendingSave({ ...pending, decisions, promptIndex: nextIndex });
  }

  async function beginPaymentSave(
    rows: { entry: LedgerEntry; draft: PaymentRowDraft }[],
    successMessage: string
  ) {
    const prompts: VariancePromptItem[] = [];
    for (const { entry, draft } of rows) {
      const projected = entryFromDraft(entry, {
        ...draft,
        variance_accepted: false,
        variance_amount: 0,
        variance_notes: "",
      });
      const amount = getLedgerVarianceBeforeAcceptance(projected);
      if (Math.abs(amount) >= 0.005) {
        prompts.push({
          entryId: entry.id,
          amount,
          clientName: clientLabel(entry, clientNames),
          description: entry.description?.trim() || "—",
          existingNotes: (draft.variance_notes || entry.variance_notes || "").trim(),
        });
      }
    }

    if (prompts.length === 0) {
      const ok = await persistPaymentDrafts(rows, {});
      if (!ok) return;
      setSuccess(successMessage);
      await loadData();
      return;
    }

    setPendingSave({
      rows,
      prompts,
      promptIndex: 0,
      decisions: {},
      successMessage,
    });
  }

  async function submitHistoryUpdates() {
    setSuccess(null);
    setError(null);
    const rows = editingHistoryEntries
      .map((entry) => ({ entry, draft: drafts[entry.id] }))
      .filter((row) => row.draft);

    if (rows.length === 0) {
      setError("Click Edit on at least one payment before saving.");
      return;
    }

    await beginPaymentSave(
      rows,
      `Updated ${rows.length} payment${rows.length === 1 ? "" : "s"}.`
    );
  }

  async function submitUpdates() {
    setSuccess(null);
    setError(null);
    const rows = editingEntries
      .map((entry) => ({ entry, draft: drafts[entry.id] }))
      .filter((row) => row.draft);

    if (rows.length === 0) {
      setError("Click Edit on at least one item, or use Add Payment.");
      return;
    }

    await beginPaymentSave(
      rows,
      `Updated ${rows.length} item${rows.length === 1 ? "" : "s"}.`
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Payments"
        description="Record payments against invoiced amounts. Items stay open until payment equals invoiced amount."
      />

      {(needsExpenseSetup || needsDbSetup || needsVarianceSetup) && (
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
          {needsVarianceSetup && (
            <>
              <p className="mt-2">
                Accepted variances use{" "}
                <code className="rounded bg-amber-100 px-1">variance_accepted</code>,{" "}
                <code className="rounded bg-amber-100 px-1">variance_amount</code>, and{" "}
                <code className="rounded bg-amber-100 px-1">variance_notes</code>. Run this in
                Supabase SQL Editor, then refresh:
              </p>
              <pre className="mt-3 overflow-x-auto rounded-md border border-amber-200 bg-white p-3 text-xs text-slate-800">
                {LEDGER_VARIANCE_SETUP_SQL}
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
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm font-medium text-slate-900">Filter outstanding</p>
          {hasActiveFilters && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-9 px-2 py-1 text-xs"
              onClick={() => {
                setFilterPo("");
                setFilterInvoiceId("");
              }}
            >
              Clear PO / Invoice filters
            </Button>
          )}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Client</span>
            <select
              className={`${selectFieldClass} mt-1.5`}
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
          </label>
          <SelectField
            label="PO Number"
            value={filterPo}
            onChange={(event) => setFilterPo(event.target.value)}
          >
            <option value="">All PO numbers</option>
            {outstandingPoOptions.map((po) => (
              <option key={po} value={po}>
                {po}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Invoice ID"
            value={filterInvoiceId}
            onChange={(event) => setFilterInvoiceId(event.target.value)}
          >
            <option value="">All invoice IDs</option>
            {outstandingInvoiceOptions.map((invoiceId) => (
              <option key={invoiceId} value={invoiceId}>
                {invoiceId}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            className="min-h-11 shrink-0 whitespace-nowrap"
            disabled={!selectedClientId || loading}
            onClick={handleAddPayment}
          >
            Add Payment
          </Button>
          <span className="text-xs text-slate-500">
            Leave client blank to view all outstanding payments. Choose a client to add or edit
            payments.
          </span>
        </div>
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
          {selectedClientId || hasActiveFilters
            ? "No unpaid items match the current filters."
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
              ? "Click Edit on a row, enter payment details, then Save. Cancel discards that row."
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
                <div className="flex items-start gap-3">
                  <div className="flex w-21 shrink-0 flex-col gap-1.5">
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full min-h-[33px] px-3 py-1.5"
                      onClick={() => beginEditRow(entry)}
                      disabled={!selectedClientId || draft.editing}
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
                    <p className="font-medium text-slate-900">{clientName}</p>
                    <p className="text-sm text-slate-500">
                      {formatDate(entry.entry_date)} · {entry.invoice_id ?? "No invoice ID"}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">{entry.description || "—"}</p>
                    <p className="mt-1 text-sm font-medium text-brand-800">
                      Invoiced: {formatCurrency(getLedgerInvoicedAmountExcludingPaymentFee(entry))}
                    </p>
                    <p className="text-sm text-amber-800">
                      Outstanding:{" "}
                      <span className={outstandingBalanceClass(lineOutstandingBalance(entry, draft))}>
                        {formatCurrency(lineOutstandingBalance(entry, draft))}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                  <div className="block text-sm">
                    <span className="mb-1 block text-slate-600">Variance amount</span>
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-medium text-slate-800">
                      {formatCurrency(varianceAmountForDisplay(entry, draft))}
                    </p>
                  </div>
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
                </div>
              </article>
            );
          })}
        </div>

        <div className={paymentsTableScrollClass}>
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className={paymentsStickyHeaderClass}>Actions</th>
                <th className={paymentsStickyHeaderClass}>Client</th>
                <th className={paymentsStickyHeaderClass}>Date</th>
                <th className={paymentsStickyHeaderClass}>Invoice ID</th>
                <th className={paymentsStickyHeaderClass}>Description</th>
                <th className={paymentsStickyHeaderClass}>Invoiced Amount</th>
                <th className={paymentsStickyHeaderClass}>Outstanding</th>
                <th className={paymentsStickyHeaderClass}>Variance Amount</th>
                <th className={paymentsStickyHeaderClass}>Status</th>
                <th className={paymentsStickyHeaderClass}>Date Paid</th>
                <th className={paymentsStickyHeaderClass}>Paid To</th>
                <th className={paymentsStickyHeaderClass}>Payment Amount</th>
                <th className={paymentsStickyHeaderClass}>Payment Fee</th>
                <th className={paymentsStickyHeaderClass}>Payment Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredEntries.map((entry) => {
                const draft = drafts[entry.id];
                if (!draft) return null;

                return (
                  <tr key={entry.id}>
                    <td className="px-3 py-3">
                      <div className="flex w-21 flex-col gap-1.5">
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full min-h-[33px] px-3 py-1.5"
                          onClick={() => beginEditRow(entry)}
                          disabled={!selectedClientId || draft.editing}
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
                    <td className="px-3 py-3">
                      {entry.clients?.name ?? clientNames.get(entry.client_id) ?? "—"}
                    </td>
                    <td className="px-3 py-3">{formatDate(entry.entry_date)}</td>
                    <td className="px-3 py-3">{entry.invoice_id ?? "—"}</td>
                    <td className="px-3 py-3">{entry.description || "—"}</td>
                    <td className="px-3 py-3 font-medium">
                      {formatCurrency(getLedgerInvoicedAmountExcludingPaymentFee(entry))}
                    </td>
                    <td
                      className={`px-3 py-3 font-medium ${outstandingBalanceClass(lineOutstandingBalance(entry, draft))}`}
                    >
                      {formatCurrency(lineOutstandingBalance(entry, draft))}
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-800">
                      {formatCurrency(varianceAmountForDisplay(entry, draft))}
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
          <p className="text-xs uppercase tracking-wide text-slate-500">Editing payment total</p>
          <p className="text-xl font-semibold text-brand-800">
            {formatCurrency(totalPaymentAmount)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="danger" loading={saving} onClick={handleDeleteEditing}>
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
            <div className="flex flex-wrap items-end justify-between gap-3">
              <p className="text-sm font-medium text-slate-900">Filter payment history</p>
              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-9 px-2 py-1 text-xs"
                  onClick={() => {
                    setFilterPo("");
                    setFilterInvoiceId("");
                  }}
                >
                  Clear PO / Invoice filters
                </Button>
              )}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <SelectField
                label="Client"
                hint="Filter by client, or leave blank to show all."
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
              <SelectField
                label="PO Number"
                value={filterPo}
                onChange={(event) => setFilterPo(event.target.value)}
              >
                <option value="">All PO numbers</option>
                {historyPoOptions.map((po) => (
                  <option key={po} value={po}>
                    {po}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Invoice ID"
                value={filterInvoiceId}
                onChange={(event) => setFilterInvoiceId(event.target.value)}
              >
                <option value="">All invoice IDs</option>
                {historyInvoiceOptions.map((invoiceId) => (
                  <option key={invoiceId} value={invoiceId}>
                    {invoiceId}
                  </option>
                ))}
              </SelectField>
            </div>
          </div>

          {!loading && (
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {historyClientId || hasActiveFilters
                  ? "Payment Amount (filtered)"
                  : "Payment Amount"}
              </p>
              <p className="mt-1 text-xl font-semibold text-brand-800">
                {formatCurrency(paymentsReceivedTotal)}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Total of payment amounts you recorded. Compare to invoiced; any difference shows
                as variance.
              </p>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-slate-500">Loading payment history...</p>
          ) : filteredPaidEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              <p>No payments match the current filters.</p>
            </div>
          ) : (
            <>
            <p className="mb-3 text-xs text-slate-500">
              Click Edit on a payment, make changes, then Save. Cancel discards that row.
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
                    <div className="flex items-start gap-3">
                      <div className="flex w-21 shrink-0 flex-col gap-1.5">
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full min-h-[33px] px-3 py-1.5"
                          onClick={() => beginEditHistoryRow(entry)}
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
                          {entry.clients?.name ?? clientNames.get(entry.client_id) ?? "—"}
                        </p>
                        <p className="text-slate-500">
                          {formatDate(entry.date_paid)} · {entry.invoice_id ?? "—"}
                        </p>
                        <p className="mt-1 text-slate-700">{entry.description || "—"}</p>
                        <p className="mt-1 text-sm font-medium text-slate-800">
                          Invoiced: {formatCurrency(getLedgerInvoicedAmountExcludingPaymentFee(entry))}
                        </p>
                        <p className="mt-1 font-medium text-brand-800">
                          Payment amount: {formatCurrency(paymentAmountForLine(entry, draft))}
                        </p>
                        <p className="text-sm text-slate-600">
                          Payment fee: {formatCurrency(Number(draft.editing ? draft.payment_fee : entry.payment_fee ?? 0))}
                        </p>
                        <p className="text-sm text-slate-600">
                          Variance: {formatCurrency(varianceAmountForDisplay(entry, draft))}
                        </p>
                        <p className="text-sm text-slate-600">
                          {isLedgerLineFullyPaid(entryFromDraft(entry, draft))
                            ? "Paid in full"
                            : "Partial payment"}
                        </p>
                      </div>
                    </div>

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
                        <div className="block text-sm">
                          <span className="mb-1 block text-slate-600">Invoiced amount</span>
                          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-medium text-slate-800">
                            {formatCurrency(getLedgerInvoicedAmountExcludingPaymentFee(entry))}
                          </p>
                        </div>
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
                        <div className="block text-sm">
                          <span className="mb-1 block text-slate-600">Variance amount</span>
                          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-medium text-slate-800">
                            {formatCurrency(varianceAmountForDisplay(entry, draft))}
                          </p>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            <div className={paymentsTableScrollClass}>
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className={paymentsStickyHeaderClass}>Actions</th>
                    <th className={paymentsStickyHeaderClass}>Client</th>
                    <th className={paymentsStickyHeaderClass}>Date Paid</th>
                    <th className={paymentsStickyHeaderClass}>Invoice ID</th>
                    <th className={paymentsStickyHeaderClass}>Description</th>
                    <th className={paymentsStickyHeaderClass}>Invoiced Amount</th>
                    <th className={paymentsStickyHeaderClass}>Payment Amount</th>
                    <th className={paymentsStickyHeaderClass}>Payment Fee</th>
                    <th className={paymentsStickyHeaderClass}>Variance Amount</th>
                    <th className={paymentsStickyHeaderClass}>Status</th>
                    <th className={paymentsStickyHeaderClass}>Paid To</th>
                    <th className={paymentsStickyHeaderClass}>Payment Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPaidEntries.map((entry) => {
                    const draft = drafts[entry.id];
                    if (!draft) return null;

                    return (
                      <tr key={entry.id}>
                        <td className="px-3 py-3">
                          <div className="flex w-21 flex-col gap-1.5">
                            <Button
                              type="button"
                              variant="secondary"
                              className="w-full min-h-[33px] px-3 py-1.5"
                              onClick={() => beginEditHistoryRow(entry)}
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
                        <td className="px-3 py-3 font-medium">
                          {formatCurrency(getLedgerInvoicedAmountExcludingPaymentFee(entry))}
                        </td>
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
                        <td className="px-3 py-3 font-medium text-slate-800">
                          {formatCurrency(varianceAmountForDisplay(entry, draft))}
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Editing payment total
                </p>
                <p className="text-xl font-semibold text-brand-800">
                  {formatCurrency(totalHistoryPaymentAmount)}
                </p>
              </div>
              <Button type="button" loading={saving} onClick={submitHistoryUpdates}>
                Save
              </Button>
            </div>
            </>
          )}
        </>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {success && <p className="mt-3 text-sm text-brand-700">{success}</p>}

      {pendingSave && pendingSave.prompts[pendingSave.promptIndex] && (
        <VarianceAcceptModal
          key={pendingSave.prompts[pendingSave.promptIndex].entryId}
          amount={pendingSave.prompts[pendingSave.promptIndex].amount}
          clientName={pendingSave.prompts[pendingSave.promptIndex].clientName}
          description={pendingSave.prompts[pendingSave.promptIndex].description}
          currentIndex={pendingSave.promptIndex}
          totalCount={pendingSave.prompts.length}
          initialNotes={pendingSave.prompts[pendingSave.promptIndex].existingNotes}
          onAccept={(notes) => advanceVariancePrompt(pendingSave, true, notes)}
          onDecline={() => advanceVariancePrompt(pendingSave, false)}
        />
      )}
    </AppShell>
  );
}
