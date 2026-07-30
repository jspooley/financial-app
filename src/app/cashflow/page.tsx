"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ExpenseForm } from "@/components/forms/ExpenseForm";
import { LedgerAccountForm } from "@/components/forms/LedgerAccountForm";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { RowActions } from "@/components/ui/RowActions";
import { normalizeInvoiceId } from "@/lib/invoice-utils";
import { normalizeLedgerRow } from "@/lib/ledger-db";
import {
  COA_SALES_INCOME_CATEGORY,
  isOperatingExpenseEntry,
  isPersonalUseHiddenFromCashflow,
  isSalesIncomeCoa,
} from "@/lib/coa";
import { isCostCompanionRow } from "@/lib/cost-companions";
import { createClient } from "@/lib/supabase/client";
import {
  CASHFLOW_ACCOUNTS,
  type CashflowAccount,
  type ChartOfAccount,
  type CompanionKind,
  type LedgerEntry,
  type Purchaser,
} from "@/lib/types";
import {
  formatCurrency,
  formatDate,
  getLedgerDesignerCostWithExtras,
  isSalesUseTaxPaid,
  purchaserFromEmail,
  roundMoney,
} from "@/lib/utils";

function monthLabel(monthKey: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
  }).format(new Date(`${monthKey}-01T12:00:00`));
}

function monthKeyFromDate(value: string | null | undefined) {
  const date = typeof value === "string" ? value : "";
  return date.length >= 7 ? date.slice(0, 7) : "";
}

function isOperatingExpense(entry: LedgerEntry) {
  return isOperatingExpenseEntry(entry);
}

function isPaymentLine(entry: LedgerEntry) {
  return Number(entry.payment_amount ?? 0) > 0 && Boolean(entry.date_paid);
}

function entryHasPayment(entry: Pick<LedgerEntry, "payment_amount">) {
  return Number(entry.payment_amount ?? 0) > 0;
}

/** A ledger row can affect its entry month and, for legacy combined rows, its paid month. */
function cashflowMonthKeys(entry: LedgerEntry): string[] {
  const keys = new Set<string>();
  const entryKey = monthKeyFromDate(entry.entry_date);
  if (entryKey) keys.add(entryKey);
  if (entryHasPayment(entry)) {
    const paidKey = monthKeyFromDate(entry.date_paid);
    if (paidKey) keys.add(paidKey);
  }
  return [...keys];
}

function entryMatchesMonth(entry: LedgerEntry, monthFilter: string[]): boolean {
  if (monthFilter.length === 0) return true;
  return cashflowMonthKeys(entry).some((month) => monthFilter.includes(month));
}

function displayDate(entry: LedgerEntry): string {
  return formatDate(cashflowEntryDate(entry));
}

function cashflowEntryDate(entry: LedgerEntry) {
  return isPaymentLine(entry) && entry.date_paid
    ? entry.date_paid
    : entry.entry_date;
}

function cashflowEntryDescriptionKey(entry: LedgerEntry) {
  return (entry.description?.trim() || entry.clients?.name || "").replace(
    /\s*\(payment\)\s*$/i,
    ""
  );
}

function cashflowPaymentRank(entry: LedgerEntry) {
  return isPaymentLine(entry) || Number(entry.payment_amount ?? 0) > 0 ? 1 : 0;
}

function isSalesIncomeCredit(entry: LedgerEntry) {
  return (
    isSalesIncomeCoa(entry.coa_category) &&
    (Number(entry.payment_amount ?? 0) > 0 ||
      Number(entry.credit_amount ?? 0) > 0)
  );
}

function uniqueOrDash(values: Array<string | null | undefined>) {
  const unique = [
    ...new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    ),
  ];
  if (unique.length === 0) return "—";
  if (unique.length === 1) return unique[0];
  return "Multiple";
}

function MultiSelectDropdown({
  label,
  allLabel,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  allLabel: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeWhenClickingAway(event: PointerEvent) {
      const details = detailsRef.current;
      if (!details?.open || details.contains(event.target as Node)) return;
      details.removeAttribute("open");
    }

    document.addEventListener("pointerdown", closeWhenClickingAway);
    return () =>
      document.removeEventListener("pointerdown", closeWhenClickingAway);
  }, []);

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? options.find((option) => option.value === selected[0])?.label ??
          selected[0]
        : `${selected.length} selected`;

  return (
    <div className="text-sm">
      <span className="mb-1 block font-medium text-slate-900">{label}</span>
      <details ref={detailsRef} className="relative">
        <summary className="flex w-full cursor-pointer list-none items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700 marker:content-none">
          <span className="truncate">{summary}</span>
          <span aria-hidden="true" className="ml-2 text-xs text-slate-500">
            ▼
          </span>
        </summary>
        <div className="absolute z-40 mt-1 max-h-72 min-w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={selected.length === 0}
              onChange={onClear}
              className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500"
            />
            {allLabel}
          </label>
          {options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded px-2 py-1.5 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => onToggle(option.value)}
                className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500"
              />
              {option.label}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

type CashflowGroupType = "sales-income" | "purchase";

type CashflowGroup = {
  kind: "group";
  key: string;
  groupType: CashflowGroupType;
  invoiceId: string;
  entries: LedgerEntry[];
  date: string;
  account: string;
  title: string;
  subtitle: string;
  coaLabel: string;
  debit: number;
  credit: number;
  paidTo: string;
  purchasedBy: string;
};

type CashflowDisplayItem =
  | { kind: "entry"; entry: LedgerEntry }
  | { kind: "child"; entry: LedgerEntry; groupKey: string }
  | CashflowGroup;

const COMPANION_LABELS: Record<string, string> = {
  tax: "tax",
  shipping: "shipping",
  fee: "payment fee",
};

function purchaseGroupSubtitle(group: LedgerEntry[]) {
  const kinds = [
    ...new Set(
      group
        .map((entry) => entry.companion_kind)
        .filter((kind): kind is CompanionKind => Boolean(kind))
        .map((kind) => COMPANION_LABELS[kind] ?? kind)
    ),
  ];
  return kinds.length
    ? `Goods + ${kinds.join(", ")}`
    : `${group.length} lines`;
}

function buildCashflowGroup(
  key: string,
  groupType: CashflowGroupType,
  group: LedgerEntry[],
  monthFilter: string[],
  accountFilter: CashflowAccount[],
  showAllAccounts: boolean
): CashflowGroup {
  let debit = 0;
  let credit = 0;
  const dates: string[] = [];
  for (const entry of group) {
    const amounts = amountsForAccountFilter(
      entry,
      monthFilter,
      accountFilter,
      showAllAccounts
    );
    debit += amounts.debit;
    credit += amounts.credit;
    dates.push(cashflowEntryDate(entry));
  }
  dates.sort((a, b) => b.localeCompare(a));

  const invoiceId =
    normalizeInvoiceId(
      group.find((entry) => normalizeInvoiceId(entry.invoice_id))?.invoice_id
    ) || "";
  const parent = group.find((entry) => !entry.source_ledger_id) ?? group[0];

  return {
    kind: "group",
    key,
    groupType,
    invoiceId,
    entries: group,
    date: dates[0] ? formatDate(dates[0]) : "—",
    account: uniqueOrDash(group.map((entry) => entry.account)),
    title:
      groupType === "sales-income"
        ? `Invoice ${invoiceId} payments`
        : parent.description?.trim() || parent.clients?.name || "Purchase",
    subtitle:
      groupType === "sales-income"
        ? `${group.length} payments`
        : purchaseGroupSubtitle(group),
    coaLabel:
      groupType === "sales-income"
        ? COA_SALES_INCOME_CATEGORY
        : uniqueOrDash(group.map((entry) => entry.coa_category)),
    debit: roundMoney(debit),
    credit: roundMoney(credit),
    paidTo: uniqueOrDash(group.map((entry) => entry.paid_to)),
    purchasedBy: uniqueOrDash(group.map((entry) => entry.purchaser)),
  };
}

/**
 * Collapsible register rows. Sales Income credits collapse by invoice ID and a
 * goods line collapses together with its tax / shipping / fee companions.
 * Expanding a group re-lists its members underneath the summary row.
 */
function buildCashflowDisplayItems(
  entries: LedgerEntry[],
  monthFilter: string[],
  accountFilter: CashflowAccount[],
  showAllAccounts: boolean,
  grouped: boolean,
  expandedGroups: Set<string>
): CashflowDisplayItem[] {
  if (!grouped) {
    return entries.map((entry) => ({ kind: "entry" as const, entry }));
  }

  const visibleIds = new Set(entries.map((entry) => entry.id));

  const salesCountByInvoice = new Map<string, number>();
  for (const entry of entries) {
    if (!isSalesIncomeCredit(entry)) continue;
    const invoiceId = normalizeInvoiceId(entry.invoice_id);
    if (!invoiceId) continue;
    salesCountByInvoice.set(
      invoiceId,
      (salesCountByInvoice.get(invoiceId) ?? 0) + 1
    );
  }

  const parentsWithCompanions = new Set<string>();
  for (const entry of entries) {
    if (!isCostCompanionRow(entry)) continue;
    const parentId = entry.source_ledger_id;
    if (parentId && visibleIds.has(parentId)) parentsWithCompanions.add(parentId);
  }

  const groupKeyFor = (entry: LedgerEntry): string | null => {
    if (isCostCompanionRow(entry)) {
      const parentId = entry.source_ledger_id;
      return parentId && parentsWithCompanions.has(parentId)
        ? `purchase:${parentId}`
        : null;
    }
    if (parentsWithCompanions.has(entry.id)) return `purchase:${entry.id}`;
    if (isSalesIncomeCredit(entry)) {
      const invoiceId = normalizeInvoiceId(entry.invoice_id);
      if (invoiceId && (salesCountByInvoice.get(invoiceId) ?? 0) > 1) {
        return `sales:${invoiceId}`;
      }
    }
    return null;
  };

  const membersByKey = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    const key = groupKeyFor(entry);
    if (!key) continue;
    const members = membersByKey.get(key) ?? [];
    members.push(entry);
    membersByKey.set(key, members);
  }

  const items: CashflowDisplayItem[] = [];
  const emitted = new Set<string>();
  for (const entry of entries) {
    const key = groupKeyFor(entry);
    if (!key) {
      items.push({ kind: "entry", entry });
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);

    const members = membersByKey.get(key) ?? [entry];
    items.push(
      buildCashflowGroup(
        key,
        key.startsWith("sales:") ? "sales-income" : "purchase",
        members,
        monthFilter,
        accountFilter,
        showAllAccounts
      )
    );
    if (expandedGroups.has(key)) {
      for (const member of members) {
        items.push({ kind: "child", entry: member, groupKey: key });
      }
    }
  }
  return items;
}

/**
 * Register amounts are the row's own debit_amount / credit_amount, regardless of
 * CoA classification. Migration 060 backfilled these for legacy rows.
 */
function amountsForAccountFilter(
  entry: LedgerEntry,
  monthFilter: string[],
  accountFilter: CashflowAccount[],
  showAllAccounts: boolean
) {
  const designerCostRaw = getLedgerDesignerCostWithExtras(entry);
  const paymentRaw = Number(entry.payment_amount ?? 0);
  const entryMonthMatches =
    monthFilter.length === 0 ||
    monthFilter.includes(monthKeyFromDate(entry.entry_date));
  const paidMonthMatches =
    monthFilter.length === 0 ||
    monthFilter.includes(monthKeyFromDate(entry.date_paid));
  const debitRaw = entryMonthMatches ? Number(entry.debit_amount ?? 0) : 0;
  const creditMonthMatches =
    paymentRaw > 0 && monthKeyFromDate(entry.date_paid)
      ? paidMonthMatches
      : entryMonthMatches;
  const creditRaw = creditMonthMatches ? Number(entry.credit_amount ?? 0) : 0;
  const selected = new Set(accountFilter);
  const accountMatches =
    entry.account != null && selected.has(entry.account as CashflowAccount);
  const include = showAllAccounts || accountMatches;
  const showDesignerCost = include && designerCostRaw > 0;
  const showPayment = include && paymentRaw > 0;
  const showDebit = include && debitRaw > 0;
  const showCredit = include && creditRaw > 0;

  return {
    designerCost: include ? designerCostRaw : 0,
    payment: include ? paymentRaw : 0,
    debit: include ? debitRaw : 0,
    credit: include ? creditRaw : 0,
    showDesignerCost,
    showPayment,
    showDebit,
    showCredit,
  };
}

function entryMatchesAccountFilter(
  entry: LedgerEntry,
  accountFilter: CashflowAccount[]
): boolean {
  const selected = new Set(accountFilter);
  return Boolean(
    entry.account && selected.has(entry.account as CashflowAccount)
  );
}

/** Register net for Checking accounts: credits − debits (cash on hand). */
function checkingBalance(
  entries: LedgerEntry[],
  parentById: Map<string, LedgerEntry>
): number {
  return roundMoney(
    entries
      .filter(
        (entry) =>
          entry.account?.startsWith("Checking") &&
          !isPersonalUseHiddenFromCashflow(entry, parentById)
      )
      .reduce((sum, entry) => {
        const amounts = amountsForAccountFilter(entry, [], [], true);
        return sum + amounts.credit - amounts.debit;
      }, 0)
  );
}

/**
 * S&U tax collected from clients but not yet remitted to the state. Tax is a
 * liability, so it is tracked here rather than as revenue or expense. Lines are
 * cleared by marking them paid on the Sales & Use Tax page.
 */
function salesUseTaxPayable(entries: LedgerEntry[]): number {
  return roundMoney(
    entries
      .filter(
        (entry) =>
          entry.wholesale_retail === "wholesale" &&
          Number(entry.tax_amount ?? 0) > 0 &&
          !isSalesUseTaxPaid(entry)
      )
      .reduce((sum, entry) => sum + Number(entry.tax_amount ?? 0), 0)
  );
}

/** Credit card balance owed: debits − credits (charges minus payments). */
function creditCardBalance(
  entries: LedgerEntry[],
  parentById: Map<string, LedgerEntry>
): number {
  return roundMoney(
    entries
      .filter(
        (entry) =>
          entry.account?.startsWith("Credit Card") &&
          !isPersonalUseHiddenFromCashflow(entry, parentById)
      )
      .reduce((sum, entry) => {
        const amounts = amountsForAccountFilter(entry, [], [], true);
        return sum + amounts.debit - amounts.credit;
      }, 0)
  );
}

export default function CashflowPage() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  /** When set, Assign Account updates every Sales Income row in the rollup. */
  const [editingAccountEntries, setEditingAccountEntries] = useState<
    LedgerEntry[] | null
  >(null);
  const [defaultDesigner, setDefaultDesigner] = useState<Purchaser>("Jess");
  /** Empty = show all accounts; otherwise match any selected account. */
  const [accountFilter, setAccountFilter] = useState<CashflowAccount[]>([]);
  /** Empty = all months; otherwise YYYY-MM. */
  const [monthFilter, setMonthFilter] = useState<string[]>([]);
  /** Empty = all invoices; otherwise match any selected invoice ID. */
  const [invoiceFilter, setInvoiceFilter] = useState<string[]>([]);
  /** Empty = all CoA categories; otherwise match any selected category. */
  const [coaCategoryFilter, setCoaCategoryFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<"date" | "description">("date");
  const [grouped, setGrouped] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set()
  );
  const [savingCoaId, setSavingCoaId] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();
    // Cashflow is a complete register: classification never controls visibility.
    const [
      { data, error },
      { data: chartData, error: chartError },
    ] = await Promise.all([
      supabase
        .from("ledger")
        .select("*, clients(name)")
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(10000),
      supabase
        .from("chart_of_accounts")
        .select("*")
        .order("category", { ascending: true }),
    ]);
    if (error) {
      setLoadError(error.message);
      setEntries([]);
    } else {
      setEntries((data ?? []).map((row) => normalizeLedgerRow(row)));
    }
    setChartOfAccounts(chartData ?? []);
    if (chartError) {
      setLoadError(
        (current) =>
          current ??
          "Chart of accounts table not found. Run migration 054_chart_of_accounts.sql in Supabase."
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    async function loadDesignerDefault() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setDefaultDesigner(purchaserFromEmail(user?.email) ?? "Jess");
    }
    void loadDesignerDefault();
  }, []);

  const parentById = useMemo(() => {
    const map = new Map<string, LedgerEntry>();
    for (const entry of entries) {
      map.set(entry.id, entry);
    }
    return map;
  }, [entries]);

  const accountBalances = useMemo(
    () => ({
      checking: checkingBalance(entries, parentById),
      creditCard: creditCardBalance(entries, parentById),
      salesUseTaxPayable: salesUseTaxPayable(entries),
    }),
    [entries, parentById]
  );

  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    for (const entry of entries) {
      for (const key of cashflowMonthKeys(entry)) {
        months.add(key);
      }
    }
    return [...months].sort((a, b) => b.localeCompare(a));
  }, [entries]);

  const invoiceOptions = useMemo(() => {
    const invoices = new Set<string>();
    for (const entry of entries) {
      const invoiceId = normalizeInvoiceId(entry.invoice_id);
      if (invoiceId) invoices.add(invoiceId);
    }
    return [...invoices].sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const showAllAccounts = accountFilter.length === 0;
  const showAllCoaCategories = coaCategoryFilter.length === 0;

  const visibleEntries = useMemo(() => {
    let result = entries.filter(
      (entry) => !isPersonalUseHiddenFromCashflow(entry, parentById)
    );
    if (monthFilter.length > 0) {
      result = result.filter((entry) => entryMatchesMonth(entry, monthFilter));
    }
    if (invoiceFilter.length > 0) {
      const selectedInvoices = new Set(
        invoiceFilter.map((invoiceId) => invoiceId.toLowerCase())
      );
      result = result.filter((entry) =>
        selectedInvoices.has(normalizeInvoiceId(entry.invoice_id).toLowerCase())
      );
    }
    if (!showAllAccounts) {
      result = result.filter((entry) =>
        entryMatchesAccountFilter(entry, accountFilter)
      );
    }
    if (!showAllCoaCategories) {
      const selected = new Set(coaCategoryFilter);
      result = result.filter(
        (entry) =>
          entry.coa_category != null && selected.has(entry.coa_category)
      );
    }
    return [...result].sort((a, b) => {
      if (sortBy === "description") {
        const byDescription = cashflowEntryDescriptionKey(a).localeCompare(
          cashflowEntryDescriptionKey(b),
          undefined,
          { sensitivity: "base" }
        );
        if (byDescription !== 0) return byDescription;

        const byDate = cashflowEntryDate(b).localeCompare(cashflowEntryDate(a));
        if (byDate !== 0) return byDate;

        return cashflowPaymentRank(a) - cashflowPaymentRank(b);
      }

      const byDate = cashflowEntryDate(b).localeCompare(cashflowEntryDate(a));
      if (byDate !== 0) return byDate;

      const byDescription = cashflowEntryDescriptionKey(a).localeCompare(
        cashflowEntryDescriptionKey(b),
        undefined,
        { sensitivity: "base" }
      );
      if (byDescription !== 0) return byDescription;

      return cashflowPaymentRank(a) - cashflowPaymentRank(b);
    });
  }, [
    entries,
    parentById,
    accountFilter,
    showAllAccounts,
    monthFilter,
    invoiceFilter,
    coaCategoryFilter,
    showAllCoaCategories,
    sortBy,
  ]);

  const filteredTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const entry of visibleEntries) {
      const amounts = amountsForAccountFilter(
        entry,
        monthFilter,
        accountFilter,
        showAllAccounts
      );
      debit += amounts.debit;
      credit += amounts.credit;
    }
    return {
      debit: roundMoney(debit),
      credit: roundMoney(credit),
      net: roundMoney(credit - debit),
    };
  }, [visibleEntries, monthFilter, accountFilter, showAllAccounts]);

  const displayItems = useMemo(
    () =>
      buildCashflowDisplayItems(
        visibleEntries,
        monthFilter,
        accountFilter,
        showAllAccounts,
        grouped,
        expandedGroups
      ),
    [
      visibleEntries,
      monthFilter,
      accountFilter,
      showAllAccounts,
      grouped,
      expandedGroups,
    ]
  );

  const groupKeys = useMemo(
    () =>
      displayItems
        .filter((item): item is Extract<CashflowDisplayItem, { kind: "group" }> =>
          item.kind === "group"
        )
        .map((item) => item.key),
    [displayItems]
  );

  function toggleGroup(key: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const hasActiveListFilters =
    !showAllAccounts ||
    monthFilter.length > 0 ||
    invoiceFilter.length > 0 ||
    !showAllCoaCategories;

  function toggleAccountFilter(account: CashflowAccount) {
    setAccountFilter((current) =>
      current.includes(account)
        ? current.filter((value) => value !== account)
        : [...current, account]
    );
  }

  function toggleCoaCategoryFilter(category: string) {
    setCoaCategoryFilter((current) =>
      current.includes(category)
        ? current.filter((value) => value !== category)
        : [...current, category]
    );
  }

  function toggleMonthFilter(month: string) {
    setMonthFilter((current) =>
      current.includes(month)
        ? current.filter((value) => value !== month)
        : [...current, month]
    );
  }

  function toggleInvoiceFilter(invoiceId: string) {
    setInvoiceFilter((current) =>
      current.includes(invoiceId)
        ? current.filter((value) => value !== invoiceId)
        : [...current, invoiceId]
    );
  }

  async function handleDelete(entry: LedgerEntry) {
    const label = entry.description?.trim() || formatDate(entry.entry_date);
    if (!confirm(`Delete cashflow entry "${label}"?`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("ledger").delete().eq("id", entry.id);
    if (error) {
      alert(error.message);
      return;
    }
    loadEntries();
  }

  async function handleCoaCategoryChange(entryId: string, category: string) {
    const next = category.trim() || null;
    const previous =
      entries.find((entry) => entry.id === entryId)?.coa_category ?? null;
    if (previous === next) return;

    setSavingCoaId(entryId);
    setEntries((current) =>
      current.map((entry) =>
        entry.id === entryId ? { ...entry, coa_category: next } : entry
      )
    );

    const supabase = createClient();
    const { error } = await supabase
      .from("ledger")
      .update({ coa_category: next })
      .eq("id", entryId);

    if (error) {
      setEntries((current) =>
        current.map((entry) =>
          entry.id === entryId ? { ...entry, coa_category: previous } : entry
        )
      );
      alert(error.message);
    }
    setSavingCoaId(null);
  }

  function closeForms() {
    setShowForm(false);
    setEditing(null);
    setEditingAccountEntries(null);
  }

  function openAccountEditor(entries: LedgerEntry[]) {
    if (entries.length === 0) return;
    setEditingAccountEntries(entries);
    setEditing(entries[0]);
    setShowForm(true);
  }

  return (
    <AppShell>
      <PageHeader
        title="Cashflow"
        description="Track operating cashflow by department, account, and payments on the ledger."
        action={
          !showForm && (
            <Button
              onClick={() => {
                setEditing(null);
                setEditingAccountEntries(null);
                setShowForm(true);
              }}
            >
              Add Entry
            </Button>
          )
        }
      />

      {showForm ? (
        editingAccountEntries ||
        (editing && !isOperatingExpenseEntry(editing)) ? (
          <LedgerAccountForm
            entries={editingAccountEntries ?? (editing ? [editing] : [])}
            onCancel={closeForms}
            onSuccess={() => {
              closeForms();
              loadEntries();
            }}
          />
        ) : (
          <ExpenseForm
            initial={editing}
            chartOfAccounts={chartOfAccounts}
            defaultDesigner={defaultDesigner}
            onCancel={closeForms}
            onSuccess={() => {
              closeForms();
              loadEntries();
            }}
            onDeleted={() => {
              closeForms();
              loadEntries();
            }}
          />
        )
      ) : loading ? (
        <p className="text-sm text-slate-500">Loading cashflow...</p>
      ) : loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">Could not load cashflow.</p>
          <p className="mt-1">{loadError}</p>
          <p className="mt-2 text-xs text-red-700/80">
            If columns are missing, run migration{" "}
            <code className="rounded bg-red-100 px-1">053_ledger_expense_fields.sql</code>{" "}
            in Supabase.
          </p>
          <Button variant="secondary" className="mt-3" onClick={() => loadEntries()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:max-w-3xl lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Checking Balance
              </p>
              <p className="mt-1 text-2xl font-bold text-brand-800">
                {formatCurrency(accountBalances.checking)}
              </p>
              <p className="mt-1 text-xs text-slate-500">Credits − debits</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Credit Card Balance
              </p>
              <p className="mt-1 text-2xl font-bold text-brand-800">
                {formatCurrency(accountBalances.creditCard)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Amount owed (debits − credits)
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                S&amp;U Tax Payable
              </p>
              <p className="mt-1 text-2xl font-bold text-brand-800">
                {formatCurrency(accountBalances.salesUseTaxPayable)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Collected, not yet remitted
              </p>
            </div>
          </section>

          <div className="mb-4 space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">
                  Filter by account
                </p>
                {!showAllAccounts && (
                  <button
                    type="button"
                    onClick={() => setAccountFilter([])}
                    className="text-sm font-medium text-brand-700 hover:text-brand-900"
                  >
                    Show all accounts
                  </button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={showAllAccounts}
                    onChange={() => setAccountFilter([])}
                    className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500"
                  />
                  Show all
                </label>
                {CASHFLOW_ACCOUNTS.map((account) => (
                  <label
                    key={account}
                    className="inline-flex items-center gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={accountFilter.includes(account)}
                      onChange={() => toggleAccountFilter(account)}
                      className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500"
                    />
                    {account}
                  </label>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 sm:max-w-md">
              <MultiSelectDropdown
                label="CoA Categories"
                allLabel="All categories"
                options={chartOfAccounts.map((account) => ({
                  value: account.category,
                  label: account.category,
                }))}
                selected={coaCategoryFilter}
                onToggle={toggleCoaCategoryFilter}
                onClear={() => setCoaCategoryFilter([])}
              />
              {chartOfAccounts.length === 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  No categories yet. Add them on the Chart of Accounts page.
                </p>
              )}
            </div>

            <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-3 lg:max-w-3xl">
              <MultiSelectDropdown
                label="Months"
                allLabel="All months"
                options={monthOptions.map((monthKey) => ({
                  value: monthKey,
                  label: monthLabel(monthKey),
                }))}
                selected={monthFilter}
                onToggle={toggleMonthFilter}
                onClear={() => setMonthFilter([])}
              />
              <MultiSelectDropdown
                label="Invoice IDs"
                allLabel="All invoice IDs"
                options={invoiceOptions.map((invoiceId) => ({
                  value: invoiceId,
                  label: invoiceId,
                }))}
                selected={invoiceFilter}
                onToggle={toggleInvoiceFilter}
                onClear={() => setInvoiceFilter([])}
              />
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-900">
                  Sort by
                </span>
                <select
                  value={sortBy}
                  onChange={(event) =>
                    setSortBy(event.target.value as "date" | "description")
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="date">Date</option>
                  <option value="description">Description</option>
                </select>
              </label>
              <div className="text-sm">
                <span className="mb-1 block font-medium text-slate-900">
                  Grouping
                </span>
                <label className="inline-flex items-center gap-2 text-slate-700">
                  <input
                    type="checkbox"
                    checked={grouped}
                    onChange={(event) => setGrouped(event.target.checked)}
                    className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  Group related rows
                </label>
                {grouped && groupKeys.length > 0 && (
                  <div className="mt-1.5 flex gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setExpandedGroups(new Set(groupKeys))}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      Expand all
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedGroups(new Set())}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      Collapse all
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3 lg:max-w-lg">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Debits
                </p>
                <p className="mt-0.5 text-lg font-semibold text-slate-900">
                  {formatCurrency(filteredTotals.debit)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Credits
                </p>
                <p className="mt-0.5 text-lg font-semibold text-slate-900">
                  {formatCurrency(filteredTotals.credit)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Total
                </p>
                <p className="mt-0.5 text-lg font-semibold text-slate-900">
                  {formatCurrency(filteredTotals.net)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">Credits − debits</p>
              </div>
            </div>

            {hasActiveListFilters && (
              <p className="text-xs text-slate-500">
                Showing {displayItems.length} rows ({visibleEntries.length}{" "}
                source {visibleEntries.length === 1 ? "entry" : "entries"}
                {grouped && groupKeys.length > 0
                  ? `; ${groupKeys.length} grouped`
                  : ""}
                ) of {entries.length} total
              </p>
            )}
          </div>

          <DataTable
            stickyFirstColumn
            stickyHeader
            maxBodyHeight="calc(100dvh - 14rem)"
            mobileTitleKey="date"
            columns={[
              { key: "actions", label: "Actions" },
              { key: "date", label: "Date" },
              { key: "account", label: "Account" },
              { key: "description", label: "Description" },
              { key: "coaCategory", label: "CoA Category" },
              { key: "debit", label: "Debit" },
              { key: "credit", label: "Credit" },
              { key: "purchasedBy", label: "Purchased By" },
              { key: "paidTo", label: "Paid To" },
              { key: "invoiceId", label: "Invoice ID" },
            ]}
            rows={displayItems.map((item) => {
              if (item.kind === "group") {
                const expanded = expandedGroups.has(item.key);
                return {
                  actions: (
                    <div className="flex flex-col gap-1.5">
                      <Button
                        variant="secondary"
                        className="w-full min-h-[33px] px-3 py-1.5"
                        onClick={() => toggleGroup(item.key)}
                      >
                        {expanded
                          ? "− Collapse"
                          : `+ Expand (${item.entries.length})`}
                      </Button>
                      <Button
                        variant="secondary"
                        className="w-full min-h-[33px] px-3 py-1.5"
                        onClick={() => openAccountEditor(item.entries)}
                      >
                        Edit Account
                      </Button>
                    </div>
                  ),
                  date: item.date,
                  account: item.account,
                  description: (
                    <div>
                      <p className="font-semibold text-slate-900">
                        {item.title}
                      </p>
                      <p className="text-xs text-slate-500">{item.subtitle}</p>
                    </div>
                  ),
                  coaCategory: (
                    <span className="text-slate-700">{item.coaLabel}</span>
                  ),
                  debit: item.debit > 0 ? formatCurrency(item.debit) : "—",
                  credit: item.credit > 0 ? formatCurrency(item.credit) : "—",
                  purchasedBy: item.purchasedBy,
                  paidTo: item.paidTo,
                  invoiceId: item.invoiceId || "—",
                };
              }

              const entry = item.entry;
              const isChild = item.kind === "child";
              const isCompanion = isCostCompanionRow(entry);
              const isExpense = isOperatingExpense(entry);
              const amounts = amountsForAccountFilter(
                entry,
                monthFilter,
                accountFilter,
                showAllAccounts
              );
              return {
                actions: isExpense ? (
                  <RowActions
                    onEdit={() => {
                      setEditingAccountEntries(null);
                      setEditing(entry);
                      setShowForm(true);
                    }}
                    onDelete={() => handleDelete(entry)}
                  />
                ) : (
                  <Button
                    variant="secondary"
                    className="w-full min-h-[33px] px-3 py-1.5"
                    onClick={() => openAccountEditor([entry])}
                  >
                    Edit Account
                  </Button>
                ),
                date: displayDate(entry),
                account: entry.account ?? "—",
                coaCategory: isCompanion ? (
                  // Cost companions are rebuilt from the parent on save, so a
                  // manual CoA change here would not stick.
                  <span className="text-slate-600">
                    {entry.coa_category ?? "—"}
                  </span>
                ) : (
                  <select
                    value={entry.coa_category ?? ""}
                    disabled={
                      savingCoaId === entry.id || chartOfAccounts.length === 0
                    }
                    onChange={(event) => {
                      void handleCoaCategoryChange(
                        entry.id,
                        event.target.value
                      );
                    }}
                    className="min-w-[10rem] max-w-[16rem] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
                    aria-label={`CoA category for ${displayDate(entry)}`}
                  >
                    <option value="">Select...</option>
                    {chartOfAccounts.map((account) => (
                      <option key={account.id} value={account.category}>
                        {account.category}
                      </option>
                    ))}
                  </select>
                ),
                debit: amounts.showDebit
                  ? formatCurrency(amounts.debit)
                  : "—",
                credit: amounts.showCredit
                  ? formatCurrency(amounts.credit)
                  : "—",
                purchasedBy: amounts.showDesignerCost
                  ? entry.purchaser ?? "—"
                  : "—",
                paidTo: amounts.showPayment ? entry.paid_to ?? "—" : "—",
                invoiceId: normalizeInvoiceId(entry.invoice_id) || "—",
                description: (
                  <span className={isChild ? "block pl-5 text-slate-600" : ""}>
                    {isChild ? "↳ " : ""}
                    {entry.description?.trim() || entry.clients?.name || "—"}
                  </span>
                ),
              };
            })}
            emptyMessage={
              hasActiveListFilters
                ? "No cashflow entries match the current filters."
                : "No cashflow entries yet."
            }
          />
        </>
      )}
    </AppShell>
  );
}
