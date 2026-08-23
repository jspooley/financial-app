"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ExpenseForm } from "@/components/forms/ExpenseForm";
import { LedgerAccountForm } from "@/components/forms/LedgerAccountForm";
import { useRecordLocks } from "@/components/RecordLockProvider";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { normalizeInvoiceId } from "@/lib/invoice-utils";
import { normalizeLedgerRow } from "@/lib/ledger-db";
import {
  coaAccountNumber,
  isCogsCoa,
  isCashflowManagedEntry,
  isCashflowOperatingCoa,
  isInvoiceGoodsLine,
  isOperatingExpenseEntry,
  isPartnerToPartnerTransferCoa,
  isPersonalCardReimbursementCoa,
  isSalesIncomeCoa,
} from "@/lib/coa";
import { isCostCompanionRow } from "@/lib/cost-companions";
import {
  isCheckingAccount,
  matchingCheckingAccount,
  matchingCreditCardAccount,
} from "@/lib/account-move";
import {
  personalCardReimbursementCategory,
  billCardChargeOnInvoice,
  canBillCardChargeOnInvoice,
  cardChargeOriginNote,
  cardReimburseClusterParentId,
  cardReimburseClusterRank,
  cardReimburseNet,
  chargeCandidatesForPayment,
  cogsCategoryFromChart,
  deletePersonalCardCharge,
  duplicateCardChargeGroups,
  identifyMovedRowAsCharge,
  identifyMovedRowAsReimbursement,
  isCardReimburseMateRow,
  isCheckingCardReimbursement,
  isPersonalCardCharge,
  linkCardChargeToReimbursement,
  mergeCardReimburseDisplayMates,
  needsPersonalCardIdentification,
  outstandingPersonalCardTotal,
  persistAmountMatchedReimbursements,
  persistOldestFirstReimbursements,
  recodeCheckingPaymentToPersonalCardReimburse,
  proposeAmountMatchedReimbursements,
  reimbursementByPaymentId,
  reimbursementCandidatesForCharge,
  reimbursementStatus,
  unlinkCardChargeReimbursement,
  withCardReimburseCluster,
} from "@/lib/card-reimbursement";
import {
  isPartnerTransferMateRow,
  isPartnerTransferParentRow,
  mergePartnerTransferDisplayMates,
} from "@/lib/partner-transfer";
import { isPaymentCompanionRow } from "@/lib/payment-companions";
import { loadLedgerLockTargets } from "@/lib/record-lock";
import { createClient } from "@/lib/supabase/client";
import {
  CASHFLOW_ACCOUNTS,
  type CashflowAccount,
  type ChartOfAccount,
  type LedgerEntry,
  type Purchaser,
} from "@/lib/types";
import {
  formatCurrency,
  formatDate,
  getLedgerDesignerCostWithExtras,
  getLedgerTotalDesignerCost,
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

/** Cash-basis amount: credits/deposits positive, debits/payments negative. */
function signedCashAmount(debit: number, credit: number) {
  return roundMoney(credit - debit);
}

function formatSignedCash(value: number) {
  if (Math.abs(value) < 0.005) return "—";
  return (
    <span className={value < 0 ? "tabular-nums text-red-700" : "tabular-nums text-slate-900"}>
      {formatCurrency(value)}
    </span>
  );
}

function reimbursementRowLabel(entry: LedgerEntry, extra?: string) {
  const amount = formatCurrency(Math.abs(cardReimburseNet(entry)));
  const description = (entry.description ?? "").trim() || "No description";
  const parts = [
    formatDate(entry.entry_date),
    amount,
    entry.account ?? "",
    description.length > 48 ? `${description.slice(0, 48)}…` : description,
  ];
  if (extra) parts.push(extra);
  return parts.filter(Boolean).join(" · ");
}

function accountMoveColumnError(message: string) {
  if (message.toLowerCase().includes("column")) {
    return "Run migrations 071–074 in Supabase (moved_from_account, reimbursed_by_ledger_id, personal_card_role, CoA 306/308), then try again.";
  }
  return message;
}

function reimbursementSetRole(
  entry: LedgerEntry
): "purchase" | "card-paydown" | null {
  if (isCardReimburseMateRow(entry)) return "card-paydown";
  if (isPersonalCardCharge(entry) && entry.reimbursed_by_ledger_id) {
    return "purchase";
  }
  return null;
}

function isOperatingExpense(entry: LedgerEntry) {
  return isCashflowManagedEntry(entry);
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

/**
 * When a month filter is on, also keep other rows that share an invoice ID with a
 * month-matching row. Sales Income credits often use date_paid while COGS goods
 * use entry_date, so without this the related debits disappear from the month view.
 */
function entriesMatchingMonthWithInvoiceMates(
  entries: LedgerEntry[],
  monthFilter: string[]
): LedgerEntry[] {
  if (monthFilter.length === 0) return entries;
  return withInvoiceMates(
    entries.filter((entry) => entryMatchesMonth(entry, monthFilter)),
    entries
  );
}

/**
 * Expand a filtered row set with invoice-linked mates from `pool` (sales ↔ COGS,
 * payment companion ↔ goods parent). Account/CoA filters otherwise hide the
 * other side of the same invoice.
 */
function withInvoiceMates(
  matched: LedgerEntry[],
  pool: LedgerEntry[]
): LedgerEntry[] {
  if (matched.length === 0) return matched;

  const paymentInvoiceByParentId = buildPaymentInvoiceByParentId(pool);
  const mateKeys = new Set<string>();
  const addKey = (key: string | null | undefined) => {
    if (key) mateKeys.add(key);
  };

  for (const entry of matched) {
    if (
      isPartnerTransferMateRow(entry) ||
      isPartnerTransferParentRow(entry)
    ) {
      continue;
    }
    const invoiceId = effectiveInvoiceId(entry, paymentInvoiceByParentId);
    if (invoiceId) addKey(`inv:${invoiceId.toLowerCase()}`);
    if (isPaymentCompanionRow(entry) && entry.source_ledger_id) {
      addKey(`parent:${entry.source_ledger_id}`);
      const parentInvoice = paymentInvoiceByParentId.get(entry.source_ledger_id);
      if (parentInvoice) addKey(`inv:${parentInvoice.toLowerCase()}`);
    }
    if (!entry.source_ledger_id) addKey(`parent:${entry.id}`);
  }

  if (mateKeys.size === 0) return matched;

  const includedIds = new Set(matched.map((entry) => entry.id));
  const mates = pool.filter((entry) => {
    if (includedIds.has(entry.id)) return false;
    if (
      isPartnerTransferMateRow(entry) ||
      isPartnerTransferParentRow(entry)
    ) {
      return false;
    }
    const invoiceId = effectiveInvoiceId(entry, paymentInvoiceByParentId);
    if (invoiceId && mateKeys.has(`inv:${invoiceId.toLowerCase()}`)) return true;
    if (isPaymentCompanionRow(entry) && entry.source_ledger_id) {
      if (mateKeys.has(`parent:${entry.source_ledger_id}`)) return true;
    }
    if (!entry.source_ledger_id && mateKeys.has(`parent:${entry.id}`)) return true;
    return false;
  });

  return mates.length === 0 ? matched : [...matched, ...mates];
}

function displayDate(entry: LedgerEntry): string {
  return formatDate(cashflowEntryDate(entry));
}

function cashflowEntryDate(entry: LedgerEntry) {
  return isPaymentLine(entry) && entry.date_paid
    ? entry.date_paid
    : entry.entry_date;
}

function cashflowEntryDescriptionKey(
  entry: LedgerEntry,
  parentById?: Map<string, LedgerEntry>
) {
  const parent =
    entry.source_ledger_id && parentById
      ? parentById.get(entry.source_ledger_id)
      : undefined;
  const raw =
    parent?.description?.trim() ||
    entry.description?.trim() ||
    entry.clients?.name ||
    "";
  return raw
    .replace(/\s*\(payment\)\s*$/i, "")
    .replace(/\s*\(shipping\)\s*$/i, "")
    .replace(/\s*\(payment fee\)\s*$/i, "");
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

/** Goods debit parents booked to 101 COGS (not companions). */
function isCogsGoodsParent(entry: LedgerEntry) {
  return !entry.source_ledger_id && isCogsCoa(entry.coa_category);
}

/**
 * Invoice on the row, or — for goods parents — the invoice from a linked payment
 * companion. Payments and COGS often need this bridge when invoice_id only landed
 * on one side of the pair.
 */
function effectiveInvoiceId(
  entry: LedgerEntry,
  paymentInvoiceByParentId: Map<string, string>
): string {
  const own = normalizeInvoiceId(entry.invoice_id);
  if (own) return own;
  if (entry.source_ledger_id) return "";
  return paymentInvoiceByParentId.get(entry.id) ?? "";
}

function buildPaymentInvoiceByParentId(entries: LedgerEntry[]) {
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (!isPaymentCompanionRow(entry) || !entry.source_ledger_id) continue;
    const invoiceId = normalizeInvoiceId(entry.invoice_id);
    if (!invoiceId) continue;
    if (!map.has(entry.source_ledger_id)) {
      map.set(entry.source_ledger_id, invoiceId);
    }
  }
  return map;
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

type CashflowGroupField =
  | "coa"
  | "invoice"
  | "paidTo"
  | "purchasedBy"
  | "department"
  | "description";

type CashflowGroupLevel = CashflowGroupField | "none";

const CASHFLOW_GROUP_FIELDS: { value: CashflowGroupField; label: string }[] = [
  { value: "coa", label: "COA Category" },
  { value: "invoice", label: "Invoice ID" },
  { value: "paidTo", label: "Paid To" },
  { value: "purchasedBy", label: "Purchased By" },
  { value: "department", label: "Department" },
  { value: "description", label: "Description" },
];

const DEFAULT_CASHFLOW_GROUP_LEVELS: [
  CashflowGroupLevel,
  CashflowGroupLevel,
  CashflowGroupLevel,
] = ["none", "none", "none"];

function activeGroupLevels(
  levels: readonly CashflowGroupLevel[]
): CashflowGroupField[] {
  const active: CashflowGroupField[] = [];
  for (const field of levels) {
    if (field === "none") break;
    active.push(field);
  }
  return active;
}

type CashflowGroupContext = {
  paymentInvoiceByParentId: Map<string, string>;
  parentById: Map<string, LedgerEntry>;
  monthFilter: string[];
  accountFilter: CashflowAccount[];
  showAllAccounts: boolean;
};

type CashflowDisplayItem =
  | {
      kind: "group";
      key: string;
      level: number;
      field: CashflowGroupField;
      label: string;
      entries: LedgerEntry[];
      debit: number;
      credit: number;
    }
  | { kind: "entry"; entry: LedgerEntry; level: number };

function GroupExpandArrow({ expanded }: { expanded: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center text-slate-500"
    >
      <span
        className={`inline-block text-[11px] leading-none transition-transform ${
          expanded ? "rotate-90" : ""
        }`}
      >
        ▶
      </span>
    </span>
  );
}

function cashflowCoaLabel(entry: Pick<LedgerEntry, "coa_category">) {
  return entry.coa_category?.trim() || "Uncategorized";
}

function compareCoaLabels(a: string, b: string) {
  if (a === "Uncategorized" && b !== "Uncategorized") return 1;
  if (b === "Uncategorized" && a !== "Uncategorized") return -1;
  const na = coaAccountNumber(a);
  const nb = coaAccountNumber(b);
  if (na != null && nb != null && na !== nb) return na - nb;
  if (na != null && nb == null) return -1;
  if (na == null && nb != null) return 1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function groupValueForField(
  entry: LedgerEntry,
  field: CashflowGroupField,
  ctx: CashflowGroupContext
) {
  switch (field) {
    case "coa":
      return cashflowCoaLabel(entry);
    case "invoice":
      return (
        effectiveInvoiceId(entry, ctx.paymentInvoiceByParentId) || "No invoice"
      );
    case "paidTo":
      return entry.paid_to?.trim() || "—";
    case "purchasedBy":
      return entry.purchaser?.trim() || "—";
    case "department":
      return entry.department?.trim() || "—";
    case "description":
      return cashflowEntryDescriptionKey(entry, ctx.parentById) || "—";
  }
}

function compareGroupLabels(
  field: CashflowGroupField,
  a: string,
  b: string
) {
  const aBlank = a === "—" || a === "No invoice";
  const bBlank = b === "—" || b === "No invoice";
  if (aBlank !== bBlank) return aBlank ? 1 : -1;
  if (field === "coa") return compareCoaLabels(a, b);
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function groupPathKey(
  parentKey: string,
  field: CashflowGroupField,
  label: string
) {
  const segment = `${field}:${label}`;
  return parentKey ? `${parentKey}\u001f${segment}` : segment;
}

function bucketEntries(
  entries: LedgerEntry[],
  field: CashflowGroupField,
  ctx: CashflowGroupContext
) {
  const buckets = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    const label = groupValueForField(entry, field, ctx);
    const members = buckets.get(label) ?? [];
    members.push(entry);
    buckets.set(label, members);
  }
  return [...buckets.entries()].sort((a, b) =>
    compareGroupLabels(field, a[0], b[0])
  );
}

function outlineGroupTotals(
  entries: LedgerEntry[],
  ctx: CashflowGroupContext
) {
  let debit = 0;
  let credit = 0;
  for (const entry of entries) {
    const amounts = amountsForAccountFilter(
      entry,
      ctx.monthFilter,
      ctx.accountFilter,
      ctx.showAllAccounts
    );
    debit += amounts.debit;
    credit += amounts.credit;
  }
  return { debit: roundMoney(debit), credit: roundMoney(credit) };
}

function buildCashflowOutlineItems(
  entries: LedgerEntry[],
  levels: CashflowGroupField[],
  expandedGroups: Set<string>,
  ctx: CashflowGroupContext,
  parentKey = "",
  depth = 0
): CashflowDisplayItem[] {
  if (depth >= levels.length) {
    return entries.map((entry) => ({
      kind: "entry" as const,
      entry,
      level: depth,
    }));
  }

  const field = levels[depth];
  const items: CashflowDisplayItem[] = [];
  for (const [label, members] of bucketEntries(entries, field, ctx)) {
    const key = groupPathKey(parentKey, field, label);
    const totals = outlineGroupTotals(members, ctx);
    items.push({
      kind: "group",
      key,
      level: depth,
      field,
      label,
      entries: members,
      debit: totals.debit,
      credit: totals.credit,
    });
    if (expandedGroups.has(key)) {
      items.push(
        ...buildCashflowOutlineItems(
          members,
          levels,
          expandedGroups,
          ctx,
          key,
          depth + 1
        )
      );
    }
  }
  return items;
}

function collectOutlineGroupKeys(
  entries: LedgerEntry[],
  levels: CashflowGroupField[],
  ctx: CashflowGroupContext,
  parentKey = "",
  depth = 0
): string[] {
  if (depth >= levels.length) return [];
  const field = levels[depth];
  const keys: string[] = [];
  for (const [label, members] of bucketEntries(entries, field, ctx)) {
    const key = groupPathKey(parentKey, field, label);
    keys.push(
      key,
      ...collectOutlineGroupKeys(members, levels, ctx, key, depth + 1)
    );
  }
  return keys;
}

/**
 * Personal-use goods (balance_sheet invoice lines) and their payment companions.
 * Cashflow Add Entry rows — including Owner's Contribution (300) equity — stay
 * visible even when Balance Sheet is checked.
 */
function isExcludedPersonalUseCashflowRow(
  entry: LedgerEntry,
  parentById: Map<string, LedgerEntry>
) {
  if (!entry.source_ledger_id && Boolean(entry.balance_sheet)) {
    // Equity / OpEx / transfers entered on Cashflow are not personal-use goods.
    if (
      isOperatingExpenseEntry(entry) ||
      isCashflowOperatingCoa(entry.coa_category)
    ) {
      return false;
    }
    if (isInvoiceGoodsLine(entry)) return true;
  }
  if (isPaymentCompanionRow(entry) && entry.source_ledger_id) {
    const parent = parentById.get(entry.source_ledger_id);
    if (
      parent &&
      Boolean(parent.balance_sheet) &&
      isInvoiceGoodsLine(parent)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Register amounts prefer posted debit_amount / credit_amount. Goods parents
 * whose debit was wiped (or never backfilled) still show designer_cost × qty
 * when that cost exists and the line is not marked personal-use.
 */
function amountsForAccountFilter(
  entry: LedgerEntry,
  monthFilter: string[],
  _accountFilter: CashflowAccount[],
  _showAllAccounts: boolean
) {
  const designerCostRaw = getLedgerDesignerCostWithExtras(entry);
  const paymentRaw = Number(entry.payment_amount ?? 0);
  const entryMonthMatches =
    monthFilter.length === 0 ||
    monthFilter.includes(monthKeyFromDate(entry.entry_date));
  const paidMonthMatches =
    monthFilter.length === 0 ||
    monthFilter.includes(monthKeyFromDate(entry.date_paid));

  const storedDebit = Number(entry.debit_amount ?? 0);
  const goodsDebitFallback =
    !entry.source_ledger_id &&
    !entry.balance_sheet &&
    storedDebit <= 0 &&
    Number(entry.designer_cost ?? 0) > 0
      ? getLedgerTotalDesignerCost(entry)
      : 0;
  const resolvedDebit = storedDebit > 0 ? storedDebit : goodsDebitFallback;

  // Pure debit rows (COGS / expenses) keep their amount whenever the row is
  // visible — including when pulled in as an invoice mate of a paid month.
  // Combined payment rows still hide debit outside the entry month.
  const storedCredit = Number(entry.credit_amount ?? 0);
  const debitRaw =
    entryMonthMatches || paymentRaw <= 0 ? resolvedDebit : 0;
  const creditMonthMatches =
    paymentRaw > 0 && monthKeyFromDate(entry.date_paid)
      ? paidMonthMatches
      : entryMonthMatches;
  const creditRaw = creditMonthMatches ? storedCredit : 0;
  const showDesignerCost = designerCostRaw > 0;
  const showPayment = paymentRaw > 0;

  return {
    designerCost: designerCostRaw,
    payment: paymentRaw,
    debit: debitRaw,
    credit: creditRaw,
    showDesignerCost,
    showPayment,
    displayDebit: resolvedDebit,
    displayCredit: storedCredit,
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

function entryMatchesCoaFilter(
  entry: LedgerEntry,
  selectedCategories: string[]
): boolean {
  if (isCardReimburseMateRow(entry)) return false;
  const category = entry.coa_category;
  if (!category) return false;
  if (selectedCategories.includes(category)) return true;
  const number = coaAccountNumber(category);
  if (number == null) return false;
  return selectedCategories.some(
    (selected) => coaAccountNumber(selected) === number
  );
}

/** Register net for Checking accounts: credits − debits (cash on hand). */
function checkingBalance(
  entries: LedgerEntry[],
  options?: {
    monthFilter?: string[];
    accountFilter?: CashflowAccount[];
    showAllAccounts?: boolean;
    parentById?: Map<string, LedgerEntry>;
  }
): number {
  const monthFilter = options?.monthFilter ?? [];
  const accountFilter = options?.accountFilter ?? [];
  const showAllAccounts = options?.showAllAccounts ?? true;
  const parentById =
    options?.parentById ?? new Map(entries.map((entry) => [entry.id, entry]));
  return roundMoney(
    entries
      .filter((entry) => entry.account?.startsWith("Checking"))
      .filter(
        (entry) =>
          showAllAccounts ||
          entryMatchesAccountFilter(entry, accountFilter)
      )
      .reduce((sum, entry) => {
        if (isExcludedPersonalUseCashflowRow(entry, parentById)) return sum;
        const amounts = amountsForAccountFilter(
          entry,
          monthFilter,
          accountFilter,
          showAllAccounts
        );
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
  options?: {
    monthFilter?: string[];
    accountFilter?: CashflowAccount[];
    showAllAccounts?: boolean;
    parentById?: Map<string, LedgerEntry>;
  }
): number {
  const monthFilter = options?.monthFilter ?? [];
  const accountFilter = options?.accountFilter ?? [];
  const showAllAccounts = options?.showAllAccounts ?? true;
  const parentById =
    options?.parentById ?? new Map(entries.map((entry) => [entry.id, entry]));
  return roundMoney(
    entries
      .filter((entry) => entry.account?.startsWith("Credit Card"))
      .filter(
        (entry) =>
          showAllAccounts ||
          entryMatchesAccountFilter(entry, accountFilter)
      )
      .reduce((sum, entry) => {
        if (isExcludedPersonalUseCashflowRow(entry, parentById)) return sum;
        const amounts = amountsForAccountFilter(
          entry,
          monthFilter,
          accountFilter,
          showAllAccounts
        );
        return sum + amounts.debit - amounts.credit;
      }, 0)
  );
}

export default function CashflowPage() {
  const { acquireLocks, releaseLocks } = useRecordLocks();
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
  const [showCardPaydowns, setShowCardPaydowns] = useState(false);
  /** Empty = all months; otherwise YYYY-MM. */
  const [monthFilter, setMonthFilter] = useState<string[]>([]);
  /** Empty = all invoices; otherwise match any selected invoice ID. */
  const [invoiceFilter, setInvoiceFilter] = useState<string[]>([]);
  /** Empty = all CoA categories; otherwise match any selected category. */
  const [coaCategoryFilter, setCoaCategoryFilter] = useState<string[]>([]);
  const [reimbursementFilter, setReimbursementFilter] = useState<
    "all" | "needs-id" | "duplicates"
  >("all");
  const [sortBy, setSortBy] = useState<"date" | "description">("date");
  const [groupLevels, setGroupLevels] = useState<
    [CashflowGroupLevel, CashflowGroupLevel, CashflowGroupLevel]
  >(DEFAULT_CASHFLOW_GROUP_LEVELS);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set()
  );
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [linking, setLinking] = useState<
    | { kind: "charge"; entryId: string; selectedId: string }
    | { kind: "payment"; entryId: string; selectedId: string }
    | null
  >(null);

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
      let rows = (data ?? []).map((row) => normalizeLedgerRow(row));
      const match = await persistOldestFirstReimbursements(supabase, rows);
      if (match.error) {
        const missing = match.error.toLowerCase().includes("column");
        if (!missing) setLoadError(match.error);
      } else if (match.updated > 0) {
        const { data: again, error: againError } = await supabase
          .from("ledger")
          .select("*, clients(name)")
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(10000);
        if (!againError) {
          rows = (again ?? []).map((row) => normalizeLedgerRow(row));
        }
      }
      setEntries(rows);
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
    function reloadWhenVisible() {
      if (document.visibilityState === "visible") {
        void loadEntries();
      }
    }
    document.addEventListener("visibilitychange", reloadWhenVisible);
    window.addEventListener("focus", reloadWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", reloadWhenVisible);
      window.removeEventListener("focus", reloadWhenVisible);
    };
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

  const registerEntries = useMemo(
    () =>
      mergeCardReimburseDisplayMates(mergePartnerTransferDisplayMates(entries)),
    [entries]
  );

  const parentById = useMemo(() => {
    const map = new Map<string, LedgerEntry>();
    for (const entry of registerEntries) {
      map.set(entry.id, entry);
    }
    return map;
  }, [registerEntries]);

  const reimbursementMaps = useMemo(() => {
    const byId = new Map(registerEntries.map((entry) => [entry.id, entry]));
    const duplicateGroups = duplicateCardChargeGroups(registerEntries);
    return {
      byId,
      chargeByPaymentId: reimbursementByPaymentId(registerEntries),
      outstanding: outstandingPersonalCardTotal(registerEntries),
      amountMatchPairs: proposeAmountMatchedReimbursements(registerEntries).length,
      duplicateGroups,
      duplicateChargeIds: new Set(
        duplicateGroups.flatMap((group) => group.charges.map((row) => row.id))
      ),
    };
  }, [registerEntries]);

  const linkingPanel = useMemo(() => {
    if (!linking) return null;
    const source =
      registerEntries.find((entry) => entry.id === linking.entryId) ?? null;
    if (linking.kind === "charge") {
      const candidates = source
        ? reimbursementCandidatesForCharge(registerEntries, source)
        : [];
      return {
        kind: "charge" as const,
        source,
        candidates,
        selectedCandidate:
          candidates.find((row) => row.payment.id === linking.selectedId) ??
          null,
      };
    }
    const candidates = source
      ? chargeCandidatesForPayment(registerEntries, source)
      : [];
    return {
      kind: "payment" as const,
      source,
      candidates,
      selectedCandidate:
        candidates.find((row) => row.charge.id === linking.selectedId) ?? null,
    };
  }, [linking, registerEntries]);

  const needsIdentificationCount = useMemo(
    () => registerEntries.filter(needsPersonalCardIdentification).length,
    [registerEntries]
  );

  const visibleEntries = useMemo(() => {
    let result =
      monthFilter.length > 0
        ? entriesMatchingMonthWithInvoiceMates(registerEntries, monthFilter)
        : registerEntries;

    result = result.filter(
      (entry) => !isExcludedPersonalUseCashflowRow(entry, parentById)
    );

    if (invoiceFilter.length > 0) {
      const selectedInvoices = new Set(
        invoiceFilter.map((invoiceId) => invoiceId.toLowerCase())
      );
      result = result.filter((entry) =>
        selectedInvoices.has(normalizeInvoiceId(entry.invoice_id).toLowerCase())
      );
    }

    const partnerTransferCoaOnly =
      !showAllCoaCategories &&
      coaCategoryFilter.length > 0 &&
      coaCategoryFilter.every((category) =>
        isPartnerToPartnerTransferCoa(category)
      );

    // Filter CoA before account so 303/304 mates on the other checking account
    // are not dropped before they can match Molly/Jess.
    if (!showAllCoaCategories) {
      result = result.filter((entry) =>
        entryMatchesCoaFilter(entry, coaCategoryFilter)
      );
    }
    if (!showAllAccounts) {
      result = result.filter((entry) =>
        entryMatchesAccountFilter(entry, accountFilter)
      );
    }
    if (!partnerTransferCoaOnly) {
      const matched = result;
      const pool =
        monthFilter.length > 0
          ? entriesMatchingMonthWithInvoiceMates(registerEntries, monthFilter)
          : registerEntries;
      result = withInvoiceMates(matched, pool).filter(
        (entry) => !isExcludedPersonalUseCashflowRow(entry, parentById)
      );
      if (!showAllCoaCategories) {
        result = result.filter((entry) =>
          entryMatchesCoaFilter(entry, coaCategoryFilter)
        );
      }
      if (!showAllAccounts) {
        result = result.filter((entry) =>
          entryMatchesAccountFilter(entry, accountFilter)
        );
      }
    }

    if (showAllCoaCategories) {
      result = withCardReimburseCluster(result, registerEntries).filter(
        (entry) => !isExcludedPersonalUseCashflowRow(entry, parentById)
      );
    }

    // Cluster invoice mates (and payment→goods parent links) by the latest date
    // in the set so Sales Income credits sit next to related COGS debits even
    // when purchase entry_date is earlier than date_paid.
    const paymentInvoiceByParentId = buildPaymentInvoiceByParentId(result);
    const clusterDateByKey = new Map<string, string>();
    const clusterKeyFor = (entry: LedgerEntry): string | null => {
      const reimburseParent = cardReimburseClusterParentId(entry);
      if (reimburseParent) return `reimburse:${reimburseParent}`;
      const invoiceId = effectiveInvoiceId(entry, paymentInvoiceByParentId);
      if (invoiceId) return `inv:${invoiceId.toLowerCase()}`;
      if (isPaymentCompanionRow(entry) && entry.source_ledger_id) {
        return `parent:${entry.source_ledger_id}`;
      }
      if (!entry.source_ledger_id && paymentInvoiceByParentId.has(entry.id)) {
        return `parent:${entry.id}`;
      }
      return null;
    };

    for (const entry of result) {
      const key = clusterKeyFor(entry);
      if (!key) continue;
      const date = cashflowEntryDate(entry);
      const current = clusterDateByKey.get(key);
      if (!current || date > current) clusterDateByKey.set(key, date);
    }

    // Payment companion parents without invoice_id still inherit the payment date.
    for (const entry of result) {
      if (!isPaymentCompanionRow(entry) || !entry.source_ledger_id) continue;
      const payDate = cashflowEntryDate(entry);
      const parentKey = `parent:${entry.source_ledger_id}`;
      const invoiceId = normalizeInvoiceId(entry.invoice_id);
      const invKey = invoiceId ? `inv:${invoiceId.toLowerCase()}` : null;
      for (const key of [parentKey, invKey]) {
        if (!key) continue;
        const current = clusterDateByKey.get(key);
        if (!current || payDate > current) clusterDateByKey.set(key, payDate);
      }
    }

    const sortDate = (entry: LedgerEntry) => {
      const key = clusterKeyFor(entry);
      if (key && clusterDateByKey.has(key)) return clusterDateByKey.get(key)!;
      if (isPaymentCompanionRow(entry) && entry.source_ledger_id) {
        const parentKey = `parent:${entry.source_ledger_id}`;
        if (clusterDateByKey.has(parentKey)) return clusterDateByKey.get(parentKey)!;
      }
      return cashflowEntryDate(entry);
    };

    const invoiceCoaRank = (entry: LedgerEntry) => {
      if (isSalesIncomeCredit(entry)) return 0;
      if (isCogsGoodsParent(entry) || isCostCompanionRow(entry)) return 1;
      return 2;
    };

    if (reimbursementFilter === "needs-id") {
      result = result.filter(needsPersonalCardIdentification);
    } else if (reimbursementFilter === "duplicates") {
      const duplicateIds = new Set(
        reimbursementMaps.duplicateGroups.flatMap((group) =>
          group.charges.map((row) => row.id)
        )
      );
      result = result.filter((entry) => duplicateIds.has(entry.id));
    }

    return [...result].sort((a, b) => {
      if (sortBy === "description") {
        const byDescription = cashflowEntryDescriptionKey(a, parentById).localeCompare(
          cashflowEntryDescriptionKey(b, parentById),
          undefined,
          { sensitivity: "base" }
        );
        if (byDescription !== 0) return byDescription;

        const byDate = sortDate(b).localeCompare(sortDate(a));
        if (byDate !== 0) return byDate;

        return cashflowPaymentRank(a) - cashflowPaymentRank(b);
      }

      const byClusterDate = sortDate(b).localeCompare(sortDate(a));
      if (byClusterDate !== 0) return byClusterDate;

      const keyA = clusterKeyFor(a);
      const keyB = clusterKeyFor(b);
      if (keyA && keyA === keyB) {
        if (keyA.startsWith("reimburse:")) {
          const byRole = cardReimburseClusterRank(a) - cardReimburseClusterRank(b);
          if (byRole !== 0) return byRole;
        } else {
          const byCoa = invoiceCoaRank(a) - invoiceCoaRank(b);
          if (byCoa !== 0) return byCoa;
        }
      }

      const byDescription = cashflowEntryDescriptionKey(a, parentById).localeCompare(
        cashflowEntryDescriptionKey(b, parentById),
        undefined,
        { sensitivity: "base" }
      );
      if (byDescription !== 0) return byDescription;

      return cashflowPaymentRank(a) - cashflowPaymentRank(b);
    });
  }, [
    registerEntries,
    parentById,
    accountFilter,
    showAllAccounts,
    monthFilter,
    invoiceFilter,
    coaCategoryFilter,
    showAllCoaCategories,
    reimbursementFilter,
    reimbursementMaps,
    sortBy,
  ]);

  const listEntries = useMemo(
    () =>
      showCardPaydowns
        ? visibleEntries
        : visibleEntries.filter((entry) => !isCardReimburseMateRow(entry)),
    [visibleEntries, showCardPaydowns]
  );

  const hiddenCardPaydownCount = visibleEntries.length - listEntries.length;

  const accountBalances = useMemo(
    () => ({
      checking: checkingBalance(visibleEntries, {
        monthFilter,
        accountFilter,
        showAllAccounts,
        parentById,
      }),
      creditCard: creditCardBalance(visibleEntries, {
        monthFilter,
        accountFilter,
        showAllAccounts,
        parentById,
      }),
      // Liability summary is always global (not tied to bank filters).
      salesUseTaxPayable: salesUseTaxPayable(entries),
    }),
    [
      visibleEntries,
      entries,
      monthFilter,
      accountFilter,
      showAllAccounts,
      parentById,
    ]
  );

  const outlineContext = useMemo(
    () => ({
      paymentInvoiceByParentId: buildPaymentInvoiceByParentId(listEntries),
      parentById,
      monthFilter,
      accountFilter,
      showAllAccounts,
    }),
    [listEntries, parentById, monthFilter, accountFilter, showAllAccounts]
  );

  const outlineLevels = useMemo(
    () => activeGroupLevels(groupLevels),
    [groupLevels]
  );

  const displayItems = useMemo(
    () =>
      buildCashflowOutlineItems(
        listEntries,
        outlineLevels,
        expandedGroups,
        outlineContext
      ),
    [listEntries, outlineLevels, expandedGroups, outlineContext]
  );

  const allGroupKeys = useMemo(
    () => collectOutlineGroupKeys(listEntries, outlineLevels, outlineContext),
    [listEntries, outlineLevels, outlineContext]
  );

  function toggleGroup(key: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setGroupLevel(index: number, field: CashflowGroupLevel) {
    setGroupLevels((current) => {
      const next = [...current] as typeof current;
      next[index] = field;
      if (index === 0 && field === "none") {
        next[1] = "none";
        next[2] = "none";
      }
      if (index === 1 && field === "none") next[2] = "none";
      return next;
    });
    setExpandedGroups(new Set());
  }

  const hasActiveListFilters =
    !showAllAccounts ||
    monthFilter.length > 0 ||
    invoiceFilter.length > 0 ||
    !showAllCoaCategories ||
    reimbursementFilter !== "all";

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

  function closeForms() {
    void releaseLocks();
    setShowForm(false);
    setEditing(null);
    setEditingAccountEntries(null);
  }

  async function startExpenseEdit(entry: LedgerEntry) {
    const parent =
      isPartnerTransferMateRow(entry) && entry.source_ledger_id
        ? entries.find((row) => row.id === entry.source_ledger_id) ?? entry
        : entry;
    const ok = await acquireLocks(await loadLedgerLockTargets(parent.id));
    if (!ok) return;
    setEditingAccountEntries(null);
    setEditing(parent);
    setShowForm(true);
  }

  async function openAccountEditor(entries: LedgerEntry[]) {
    if (entries.length === 0) return;
    const targetLists = await Promise.all(entries.map((entry) => loadLedgerLockTargets(entry.id)));
    const ok = await acquireLocks(targetLists.flat());
    if (!ok) return;
    setEditingAccountEntries(entries);
    setEditing(entries[0]);
    setShowForm(true);
  }

  async function markMovedRowAsCharge(entry: LedgerEntry) {
    if (
      !confirm(
        `Keep this row on ${entry.account} as a personal-card purchase? It can then pair 1:1 with a checking 308 reimbursement.`
      )
    ) {
      return;
    }
    setMoveError(null);
    setMovingId(entry.id);
    const supabase = createClient();
    const error = await identifyMovedRowAsCharge(supabase, entry);
    setMovingId(null);
    if (error) {
      setMoveError(
        error.toLowerCase().includes("column")
          ? "Run migration 073_personal_card_role.sql in Supabase, then try again."
          : error
      );
      return;
    }
    await loadEntries();
  }

  async function markMovedRowAsReimbursement(entry: LedgerEntry) {
    const checking =
      matchingCheckingAccount(entry.account) ?? entry.moved_from_account;
    const card = entry.account;
    const coa308 = personalCardReimbursementCategory(chartOfAccounts);
    if (
      !confirm(
        `This was a checking reimbursement, not a card purchase.\n\nIt will move back to ${checking} as ${coa308}, a matching charge will be added on ${card}, and the two will be paired.`
      )
    ) {
      return;
    }
    setMoveError(null);
    setMovingId(entry.id);
    const supabase = createClient();
    const error = await identifyMovedRowAsReimbursement(supabase, entry, coa308);
    setMovingId(null);
    if (error) {
      setMoveError(
        error.toLowerCase().includes("column")
          ? "Run migration 073_personal_card_role.sql in Supabase, then try again."
          : error
      );
      return;
    }
    await loadEntries();
  }

  function startLinkCharge(entry: LedgerEntry) {
    const candidates = reimbursementCandidatesForCharge(registerEntries, entry);
    const preferred =
      candidates.find((row) => row.amountMatch && row.duplicateCharge) ??
      candidates.find((row) => row.amountMatch && !row.linkedCharge) ??
      candidates.find((row) => row.amountMatch) ??
      candidates[0];
    setMoveError(null);
    setLinking({
      kind: "charge",
      entryId: entry.id,
      selectedId: preferred?.payment.id ?? "",
    });
  }

  function startLinkPayment(entry: LedgerEntry) {
    const candidates = chargeCandidatesForPayment(registerEntries, entry);
    const preferred =
      candidates.find((row) => row.amountMatch) ?? candidates[0];
    setMoveError(null);
    setLinking({
      kind: "payment",
      entryId: entry.id,
      selectedId: preferred?.charge.id ?? "",
    });
  }

  async function confirmReimbursementLink() {
    if (!linking?.selectedId) return;
    const charge =
      linking.kind === "charge"
        ? reimbursementMaps.byId.get(linking.entryId)
        : reimbursementMaps.byId.get(linking.selectedId);
    const payment =
      linking.kind === "payment"
        ? reimbursementMaps.byId.get(linking.entryId)
        : reimbursementMaps.byId.get(linking.selectedId);
    if (!charge || !payment) {
      setMoveError("That row is no longer in the register. Refresh and try again.");
      setLinking(null);
      return;
    }
    const candidate =
      linking.kind === "charge"
        ? reimbursementCandidatesForCharge(registerEntries, charge).find(
            (row) => row.payment.id === payment.id
          )
        : undefined;
    if (candidate?.linkedCharge) {
      const other = candidate.linkedCharge;
      if (candidate.duplicateCharge) {
        if (
          !confirm(
            `This 308 already pays another card charge that looks like a duplicate of this one:\n${reimbursementRowLabel(
              other
            )}\n\nLinking only moves the 308 here. Nothing is deleted. Delete the extra card row yourself if it should not stay.`
          )
        ) {
          return;
        }
      } else if (
        !confirm(
          `This 308 currently reimburses another card charge (${formatDate(
            other.entry_date
          )} ${formatCurrency(
            Math.abs(cardReimburseNet(other))
          )}). Move the link here? The other card row stays.`
        )
      ) {
        return;
      }
    }
    if (candidate?.needsCoa308) {
      if (
        !confirm(
          "That checking row is not CoA 308. Change it to a personal-card reimbursement (308) and pair it with this charge?"
        )
      ) {
        return;
      }
    }
    setMovingId(charge.id);
    setMoveError(null);
    const targetLists = await Promise.all([
      loadLedgerLockTargets(charge.id),
      loadLedgerLockTargets(payment.id),
    ]);
    const ok = await acquireLocks(targetLists.flat());
    if (!ok) {
      setMovingId(null);
      return;
    }
    const supabase = createClient();
    const error = await linkCardChargeToReimbursement(
      supabase,
      charge,
      payment,
      personalCardReimbursementCategory(chartOfAccounts)
    );
    setMovingId(null);
    void releaseLocks();
    if (error) {
      setMoveError(accountMoveColumnError(error));
      return;
    }
    setLinking(null);
    await loadEntries();
  }

  async function unlinkCharge(entry: LedgerEntry) {
    if (
      !confirm(
        "Mark this card charge outstanding? It unpairs the checking reimbursement. The checking row stays; the charge goes back to Outstanding."
      )
    ) {
      return;
    }
    setMovingId(entry.id);
    setMoveError(null);
    const supabase = createClient();
    const error = await unlinkCardChargeReimbursement(supabase, entry);
    setMovingId(null);
    if (error) {
      setMoveError(accountMoveColumnError(error));
      return;
    }
    await loadEntries();
  }

  async function recodePaymentTo308(entry: LedgerEntry) {
    if (
      !confirm(
        `Change this checking row from ${entry.coa_category ?? "its current CoA"} to 308 (reimburse personal credit card)? It stays on checking and stays linked to the card charge.`
      )
    ) {
      return;
    }
    setMovingId(entry.id);
    setMoveError(null);
    const ok = await acquireLocks(await loadLedgerLockTargets(entry.id));
    if (!ok) {
      setMovingId(null);
      return;
    }
    const supabase = createClient();
    const error = await recodeCheckingPaymentToPersonalCardReimburse(
      supabase,
      entry,
      personalCardReimbursementCategory(chartOfAccounts)
    );
    setMovingId(null);
    void releaseLocks();
    if (error) {
      setMoveError(accountMoveColumnError(error));
      return;
    }
    await loadEntries();
  }

  async function billChargeAsCogs(entry: LedgerEntry) {
    const invoiceId = normalizeInvoiceId(entry.invoice_id);
    if (
      !confirm(
        `Turn this card purchase into a 101 COGS line on ${invoiceId}?\n\nIt stays on ${entry.account ?? "the card"} and stays linked to the checking 308. Do not add a second Goods and Services row.`
      )
    ) {
      return;
    }
    setMovingId(entry.id);
    setMoveError(null);
    const ok = await acquireLocks(await loadLedgerLockTargets(entry.id));
    if (!ok) {
      setMovingId(null);
      return;
    }
    const supabase = createClient();
    const error = await billCardChargeOnInvoice(
      supabase,
      entry,
      cogsCategoryFromChart(chartOfAccounts)
    );
    setMovingId(null);
    void releaseLocks();
    if (error) {
      setMoveError(accountMoveColumnError(error));
      return;
    }
    await loadEntries();
  }

  async function deleteCardChargeRow(entry: LedgerEntry) {
    if (isInvoiceGoodsLine(entry)) {
      setMoveError(
        "That row is an invoice goods line (101 COGS), not the extra reimbursement charge. Keep it. Delete the extra card charge instead: Edit on that row, then Delete."
      );
      return;
    }
    if (
      !confirm(
        `Delete this card row?\n${reimbursementRowLabel(entry)}\n${cardChargeOriginNote(
          entry
        )}.\n\nThe checking 308 is not deleted.`
      )
    ) {
      return;
    }
    setMovingId(entry.id);
    setMoveError(null);
    const targetLists = await loadLedgerLockTargets(entry.id);
    const ok = await acquireLocks(targetLists);
    if (!ok) {
      setMovingId(null);
      setMoveError(
        "Could not delete: the row is locked or edit locking is not set up. Close any lock message, then try again. You can also click Edit on that row and delete it from the form."
      );
      return;
    }
    const supabase = createClient();
    const error = await deletePersonalCardCharge(supabase, entry, entries);
    setMovingId(null);
    void releaseLocks();
    if (error) {
      setMoveError(accountMoveColumnError(error));
      return;
    }
    setLinking((current) => {
      if (!current) return current;
      if (current.entryId === entry.id) return null;
      return current;
    });
    await loadEntries();
  }

  async function pairMatchingAmounts() {
    const count = reimbursementMaps.amountMatchPairs;
    if (count === 0) return;
    if (
      !confirm(
        `Link ${count} outstanding card charge${
          count === 1 ? "" : "s"
        } to unmatched 308s with the same amount (1:1, oldest first within each amount)?`
      )
    ) {
      return;
    }
    setMoveError(null);
    setMovingId("pair-amounts");
    const supabase = createClient();
    const result = await persistAmountMatchedReimbursements(supabase, entries);
    setMovingId(null);
    if (result.error) {
      setMoveError(accountMoveColumnError(result.error));
      return;
    }
    await loadEntries();
  }

  return (
    <AppShell>
      <PageHeader
        title="Cashflow"
        description="Cash-basis register: deposits and credits are positive; payments and debits are negative."
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
        (editing && !isCashflowManagedEntry(editing)) ? (
          <LedgerAccountForm
            entries={editingAccountEntries ?? (editing ? [editing] : [])}
            chartOfAccounts={chartOfAccounts}
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
            <Link
              href="/bank-cashflow"
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-200 hover:shadow-md"
            >
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Checking Balance
              </p>
              <p className="mt-1 text-2xl font-bold text-brand-800">
                {formatCurrency(accountBalances.checking)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Credits − debits
                {hasActiveListFilters ? " (current filters)" : ""}
              </p>
              <p className="mt-2 text-xs font-medium text-brand-700">
                Checking Reconciliation →
              </p>
            </Link>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Credit Card Balance
              </p>
              <p className="mt-1 text-2xl font-bold text-brand-800">
                {formatCurrency(accountBalances.creditCard)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Amount owed (debits − credits)
                {hasActiveListFilters ? " (current filters)" : ""}
              </p>
              {reimbursementMaps.outstanding > 0 ||
              reimbursementMaps.amountMatchPairs > 0 ||
              reimbursementFilter !== "all" ? (
                <div className="mt-2 space-y-2">
                  {reimbursementMaps.outstanding > 0 ? (
                    <p className="text-xs font-medium text-amber-800">
                      Unreimbursed personal-card charges:{" "}
                      {formatCurrency(reimbursementMaps.outstanding)}
                    </p>
                  ) : null}
                  {reimbursementFilter !== "all" ||
                  reimbursementMaps.amountMatchPairs > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {reimbursementFilter !== "all" ? (
                        <button
                          type="button"
                          className="text-xs font-semibold text-brand-800 underline"
                          onClick={() => setReimbursementFilter("all")}
                        >
                          Show all rows
                        </button>
                      ) : null}
                      {reimbursementMaps.amountMatchPairs > 0 ? (
                        <button
                          type="button"
                          className="text-xs font-semibold text-brand-800 underline"
                          disabled={movingId === "pair-amounts"}
                          onClick={() => {
                            void pairMatchingAmounts();
                          }}
                        >
                          {movingId === "pair-amounts"
                            ? "Pairing..."
                            : `Pair matching amounts (${reimbursementMaps.amountMatchPairs})`}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
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
              <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={showCardPaydowns}
                  onChange={(event) => setShowCardPaydowns(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500"
                />
                Show card payments from checking
              </label>
              {needsIdentificationCount > 0 ||
              reimbursementMaps.duplicateGroups.length > 0 ? (
                <div className="mt-4 max-w-md space-y-3">
                  {needsIdentificationCount > 0 ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                      {needsIdentificationCount} moved row
                      {needsIdentificationCount === 1 ? "" : "s"} still need to
                      be identified.{" "}
                      <button
                        type="button"
                        className="font-semibold underline"
                        onClick={() => setReimbursementFilter("needs-id")}
                      >
                        Show them
                      </button>
                      , then This is a charge or This is a reimbursement on each
                      row.
                    </p>
                  ) : null}
                  {reimbursementMaps.duplicateGroups.length > 0 ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                      {reimbursementMaps.duplicateGroups.length} possible
                      duplicate card charge{" "}
                      {reimbursementMaps.duplicateGroups.length === 1
                        ? "group"
                        : "groups"}{" "}
                      (same purchase twice).{" "}
                      <button
                        type="button"
                        className="font-semibold underline"
                        onClick={() => setReimbursementFilter("duplicates")}
                      >
                        Review
                      </button>{" "}
                      and delete the extra row yourself.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <p className="text-sm font-medium text-slate-900">Filters</p>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
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
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">
                  Customize View
                </p>
                {allGroupKeys.length > 0 && (
                  <div className="flex gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setExpandedGroups(new Set(allGroupKeys))}
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
              <p className="mt-1 text-xs text-slate-500">
                Grouping starts off. Choose a highest level to nest rows; set
                lower levels to None for fewer layers.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {groupLevels.map((field, index) => (
                  <label key={index} className="block text-sm">
                    <span className="mb-1 flex items-center gap-2 font-medium text-slate-900">
                      <span className="inline-flex size-5 items-center justify-center rounded-full bg-slate-100 text-[11px] text-slate-600">
                        {index + 1}
                      </span>
                      {index === 0 ? "Highest level" : `Level ${index + 1}`}
                    </span>
                    <select
                      value={field}
                      disabled={
                        (index === 1 && groupLevels[0] === "none") ||
                        (index === 2 &&
                          (groupLevels[0] === "none" ||
                            groupLevels[1] === "none"))
                      }
                      onChange={(event) =>
                        setGroupLevel(
                          index,
                          event.target.value as CashflowGroupLevel
                        )
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      <option value="none">None</option>
                      {CASHFLOW_GROUP_FIELDS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>

            {hasActiveListFilters && (
              <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
                Checking and credit card balances above use the current filters
                (selected accounts only). 303/304 transfers show on both checking
                registers: the sender as a deduction, the receiver as an addition.
                Showing {displayItems.length} rows ({listEntries.length}{" "}
                source {listEntries.length === 1 ? "entry" : "entries"}) of{" "}
                {entries.length} total
                {hiddenCardPaydownCount > 0
                  ? ` · ${hiddenCardPaydownCount} card payment${
                      hiddenCardPaydownCount === 1 ? "" : "s"
                    } from checking hidden`
                  : ""}
              </p>
            )}
          </div>

          {moveError ? (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {moveError}
            </p>
          ) : null}

          {linking && linkingPanel ? (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
              <p className="font-medium">
                {linkingPanel.kind === "charge"
                  ? "Link a checking 308 to this card charge"
                  : "Link a card charge to this 308"}
              </p>
              <p className="mt-1 text-xs text-amber-900/80">
                {linkingPanel.kind === "charge"
                  ? "Pick the Checking 308 (personal-card refund), not a 302 owner's draw and not the Credit Card “Pays the card back” line. That card credit is already the companion of the checking 308."
                  : null}
              </p>
              {linkingPanel.source ? (
                <p className="mt-1 text-xs text-amber-900/80">
                  {reimbursementRowLabel(linkingPanel.source)}
                </p>
              ) : (
                <p className="mt-1 text-xs">
                  That row is not in the current list. Clear filters or cancel.
                </p>
              )}
              {linkingPanel.candidates.length === 0 ? (
                <p className="mt-2 text-xs">
                  {linkingPanel.kind === "charge"
                    ? "No checking 308s are available to link. Enter the repayment on checking as CoA 308 (not 302 owner's draw or 306 loan payback). If it is already tied to another card charge, pick that 308 to reassign it."
                    : "No outstanding card charges are available to link."}
                </p>
              ) : (
                <label className="mt-3 block text-xs font-medium">
                  {linkingPanel.kind === "charge"
                    ? "Checking reimbursement"
                    : "Card charge"}
                  <select
                    value={linking.selectedId}
                    onChange={(event) =>
                      setLinking((current) =>
                        current
                          ? { ...current, selectedId: event.target.value }
                          : current
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    {linkingPanel.kind === "charge"
                      ? linkingPanel.candidates.map((row) => (
                          <option key={row.payment.id} value={row.payment.id}>
                            {reimbursementRowLabel(
                              row.payment,
                              [
                                row.amountMatch ? "amount match" : null,
                                row.hasCardPaydown
                                  ? "this is the 308 for the card pay-down"
                                  : null,
                                row.duplicateCharge
                                  ? "possible duplicate — you choose what to delete"
                                  : row.linkedCharge
                                    ? "already linked — reassign"
                                    : "unmatched",
                                row.needsCoa308 ? "will become 308" : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            )}
                          </option>
                        ))
                      : linkingPanel.candidates.map((row) => (
                          <option key={row.charge.id} value={row.charge.id}>
                            {reimbursementRowLabel(
                              row.charge,
                              [
                                row.amountMatch ? "amount match" : null,
                                row.sameOwner ? null : "other owner",
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            )}
                          </option>
                        ))}
                  </select>
                </label>
              )}
              {linkingPanel.kind === "charge" &&
              linkingPanel.selectedCandidate?.linkedCharge ? (
                <div className="mt-3 rounded-md border border-amber-300 bg-white px-3 py-2 text-xs text-slate-800">
                  {linkingPanel.selectedCandidate.duplicateCharge ? (
                    <p className="font-medium text-amber-950">
                      These two card charges look like the same purchase. Nothing
                      is deleted unless you choose one below.
                    </p>
                  ) : (
                    <p className="font-medium text-amber-950">
                      This 308 already pays another card charge. Linking moves
                      the 308 here; the other card row stays unless you delete
                      it.
                    </p>
                  )}
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="rounded border border-slate-200 p-2">
                      <p className="font-semibold">This charge</p>
                      <p className="mt-1">
                        {linkingPanel.source
                          ? reimbursementRowLabel(linkingPanel.source)
                          : "—"}
                      </p>
                      {linkingPanel.source ? (
                        <p className="mt-1 text-slate-500">
                          {cardChargeOriginNote(linkingPanel.source)}
                        </p>
                      ) : null}
                      {linkingPanel.source ? (
                        <Button
                          variant="secondary"
                          className="mt-2 min-h-[33px] w-full px-3 py-1.5"
                          disabled={Boolean(movingId)}
                          onClick={() => {
                            void deleteCardChargeRow(linkingPanel.source!);
                          }}
                        >
                          Delete this card row
                        </Button>
                      ) : null}
                    </div>
                    <div className="rounded border border-slate-200 p-2">
                      <p className="font-semibold">Already linked card row</p>
                      <p className="mt-1">
                        {reimbursementRowLabel(
                          linkingPanel.selectedCandidate.linkedCharge
                        )}
                      </p>
                      <p className="mt-1 text-slate-500">
                        {cardChargeOriginNote(
                          linkingPanel.selectedCandidate.linkedCharge
                        )}
                      </p>
                      <Button
                        variant="secondary"
                        className="mt-2 min-h-[33px] w-full px-3 py-1.5"
                        disabled={Boolean(movingId)}
                        onClick={() => {
                          void deleteCardChargeRow(
                            linkingPanel.selectedCandidate!.linkedCharge!
                          );
                        }}
                      >
                        Delete the other card row
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  className="min-h-[33px] px-3 py-1.5"
                  disabled={
                    !linking.selectedId ||
                    linkingPanel.candidates.length === 0 ||
                    Boolean(movingId)
                  }
                  onClick={() => {
                    void confirmReimbursementLink();
                  }}
                >
                  {movingId ? "Linking..." : "Link these"}
                </Button>
                <Button
                  variant="secondary"
                  className="min-h-[33px] px-3 py-1.5"
                  disabled={Boolean(movingId)}
                  onClick={() => setLinking(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          <DataTable
            stickyFirstColumn
            stickyHeader
            maxBodyHeight="calc(100dvh - 14rem)"
            mobileTitleKey="group"
            rowKey={(_row, index) => {
              const item = displayItems[index];
              if (!item) return String(index);
              if (item.kind === "group") return item.key;
              return `entry:${item.entry.id}:${item.level}`;
            }}
            columns={[
              { key: "group", label: "\u00a0", className: "min-w-[16rem]" },
              { key: "actions", label: "Actions" },
              { key: "date", label: "Date" },
              { key: "account", label: "Account" },
              { key: "description", label: "Description" },
              { key: "coaCategory", label: "CoA Category" },
              { key: "amount", label: "Amount" },
              { key: "invoiceId", label: "Invoice ID" },
              { key: "purchasedBy", label: "Purchased By" },
              { key: "paidTo", label: "Paid To" },
              { key: "department", label: "Department" },
              { key: "reimbursed", label: "Reimbursed" },
            ]}
            rows={displayItems.map((item) => {
              if (item.kind === "group") {
                const expanded = expandedGroups.has(item.key);
                return {
                  group: (
                    <button
                      type="button"
                      onClick={() => toggleGroup(item.key)}
                      aria-expanded={expanded}
                      aria-label={
                        expanded
                          ? `Collapse ${item.label}`
                          : `Expand ${item.label} (${item.entries.length} transactions)`
                      }
                      className="flex w-full items-start gap-1 rounded text-left hover:bg-slate-50"
                      style={{ paddingLeft: `${item.level * 1.25}rem` }}
                    >
                      <GroupExpandArrow expanded={expanded} />
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">
                          {item.label}
                        </p>
                        <p className="text-xs text-slate-500">
                          {item.entries.length} transaction
                          {item.entries.length === 1 ? "" : "s"}
                        </p>
                      </div>
                    </button>
                  ),
                  actions: "—",
                  date: "—",
                  account: "—",
                  description: "—",
                  coaCategory: "—",
                  amount: formatSignedCash(
                    signedCashAmount(item.debit, item.credit)
                  ),
                  invoiceId: "—",
                  purchasedBy: "—",
                  paidTo: "—",
                  department: "—",
                  reimbursed: "—",
                };
              }

              const entry = item.entry;
              const isExpense =
                isOperatingExpense(entry) || isPartnerTransferMateRow(entry);
              const amounts = amountsForAccountFilter(
                entry,
                monthFilter,
                accountFilter,
                showAllAccounts
              );
              const setRole = reimbursementSetRole(entry);
              return {
                group: (
                  <div
                    className="text-slate-400"
                    style={{
                      paddingLeft:
                        setRole === "card-paydown"
                          ? `${Math.max(item.level, 0) * 1.25 + 1.25}rem`
                          : item.level === 0
                            ? undefined
                            : `${item.level * 1.25 + 1.75}rem`,
                    }}
                  >
                    {item.level === 0 && setRole !== "card-paydown" ? "" : "·"}
                  </div>
                ),
                actions: (
                  <div className="flex flex-col gap-1.5">
                    {isExpense ? (
                      <Button
                        variant="secondary"
                        className="w-full min-h-[33px] px-3 py-1.5"
                        onClick={() => {
                          void startExpenseEdit(entry);
                        }}
                      >
                        Edit
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        className="w-full min-h-[33px] px-3 py-1.5"
                        onClick={() => openAccountEditor([entry])}
                      >
                        Edit
                      </Button>
                    )}
                    {isCheckingAccount(entry.account) &&
                    reimbursementMaps.chargeByPaymentId.has(entry.id) &&
                    !isPersonalCardReimbursementCoa(entry.coa_category) ? (
                      <Button
                        variant="secondary"
                        className="w-full min-h-[33px] px-3 py-1.5"
                        disabled={movingId === entry.id}
                        onClick={() => {
                          void recodePaymentTo308(entry);
                        }}
                      >
                        {movingId === entry.id ? "Saving..." : "Change to 308"}
                      </Button>
                    ) : null}
                    {needsPersonalCardIdentification(entry) ? (
                      <>
                        <Button
                          variant="secondary"
                          className="w-full min-h-[33px] px-3 py-1.5"
                          disabled={movingId === entry.id}
                          onClick={() => {
                            void markMovedRowAsCharge(entry);
                          }}
                        >
                          {movingId === entry.id
                            ? "Saving..."
                            : "This is a charge"}
                        </Button>
                        <Button
                          variant="secondary"
                          className="w-full min-h-[33px] px-3 py-1.5"
                          disabled={movingId === entry.id}
                          onClick={() => {
                            void markMovedRowAsReimbursement(entry);
                          }}
                        >
                          {movingId === entry.id
                            ? "Saving..."
                            : "This is a reimbursement"}
                        </Button>
                      </>
                    ) : null}
                    {isPersonalCardCharge(entry) &&
                    !entry.reimbursed_by_ledger_id ? (
                      <Button
                        variant="secondary"
                        className="w-full min-h-[33px] px-3 py-1.5"
                        disabled={movingId === entry.id}
                        onClick={() => startLinkCharge(entry)}
                      >
                        Reimbursed
                      </Button>
                    ) : null}
                    {isPersonalCardCharge(entry) &&
                    entry.reimbursed_by_ledger_id ? (
                      <Button
                        variant="secondary"
                        className="w-full min-h-[33px] px-3 py-1.5"
                        disabled={movingId === entry.id}
                        onClick={() => {
                          void unlinkCharge(entry);
                        }}
                      >
                        Outstanding
                      </Button>
                    ) : null}
                    {canBillCardChargeOnInvoice(entry) ? (
                      <Button
                        variant="secondary"
                        className="w-full min-h-[33px] px-3 py-1.5"
                        disabled={movingId === entry.id}
                        onClick={() => {
                          void billChargeAsCogs(entry);
                        }}
                      >
                        {movingId === entry.id
                          ? "Saving..."
                          : "Bill as 101 COGS"}
                      </Button>
                    ) : null}
                    {reimbursementMaps.duplicateChargeIds.has(entry.id) ? (
                      <Button
                        variant="secondary"
                        className="w-full min-h-[33px] px-3 py-1.5"
                        disabled={movingId === entry.id}
                        onClick={() => {
                          void deleteCardChargeRow(entry);
                        }}
                      >
                        {movingId === entry.id
                          ? "Deleting..."
                          : "Delete card row"}
                      </Button>
                    ) : null}
                    {isCheckingCardReimbursement(entry) &&
                    !reimbursementMaps.chargeByPaymentId.has(entry.id) ? (
                      <Button
                        variant="secondary"
                        className="w-full min-h-[33px] px-3 py-1.5"
                        disabled={movingId === entry.id}
                        onClick={() => startLinkPayment(entry)}
                      >
                        Link charge
                      </Button>
                    ) : null}
                  </div>
                ),
                date: displayDate(entry),
                account: (
                  <span>
                    {entry.account ?? "—"}
                    {setRole === "purchase" ? (
                      <span className="mt-0.5 block text-xs font-medium text-slate-600">
                        1 · Card purchase
                      </span>
                    ) : null}
                    {setRole === "card-paydown" ? (
                      <span className="mt-0.5 block text-xs font-medium text-slate-600">
                        2 · Pays the card back
                      </span>
                    ) : null}
                    {entry.moved_from_account ? (
                      <span className="mt-0.5 block text-xs font-medium text-amber-800">
                        Moved from {entry.moved_from_account}
                      </span>
                    ) : null}
                  </span>
                ),
                coaCategory: (
                  <span className="text-slate-600">
                    {setRole === "card-paydown"
                      ? "Card pay-down"
                      : (entry.coa_category ?? "—")}
                    {setRole === "card-paydown" &&
                    entry.coa_category &&
                    isPersonalCardReimbursementCoa(entry.coa_category) ? (
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {entry.coa_category}
                      </span>
                    ) : null}
                    {isCheckingAccount(entry.account) &&
                    reimbursementMaps.chargeByPaymentId.has(entry.id) &&
                    !isPersonalCardReimbursementCoa(entry.coa_category) ? (
                      <span className="mt-0.5 block text-xs font-medium text-amber-800">
                        Linked card refund — change CoA to 308
                      </span>
                    ) : null}
                  </span>
                ),
                amount: formatSignedCash(
                  signedCashAmount(
                    amounts.displayDebit,
                    amounts.displayCredit
                  )
                ),
                purchasedBy: entry.purchaser ?? "—",
                paidTo: entry.paid_to ?? "—",
                department: entry.department ?? "—",
                invoiceId:
                  effectiveInvoiceId(
                    entry,
                    outlineContext.paymentInvoiceByParentId
                  ) || "—",
                description: (
                  <span>
                    {cashflowEntryDescriptionKey(entry, parentById) ||
                      entry.clients?.name ||
                      "—"}
                    {isCardReimburseMateRow(entry) ? (
                      <span className="mt-0.5 block text-xs text-slate-500">
                        Offset of the checking 308 — not a second purchase
                      </span>
                    ) : null}
                  </span>
                ),
                reimbursed: (() => {
                  const status = reimbursementStatus(
                    entry,
                    reimbursementMaps.byId,
                    reimbursementMaps.chargeByPaymentId
                  );
                  if (status.kind === "needs-identification") {
                    return (
                      <span className="font-medium text-amber-800">
                        Identify charge or reimbursement
                      </span>
                    );
                  }
                  if (status.kind === "card-mate") {
                    return (
                      <span>
                        <span className="text-slate-700">Pays the card back</span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          Nets the card charge to $0
                        </span>
                      </span>
                    );
                  }
                  if (status.kind === "charge-outstanding") {
                    return reimbursementMaps.duplicateChargeIds.has(entry.id) ? (
                      <span className="text-xs font-medium text-amber-900">
                        Possible duplicate · {cardChargeOriginNote(entry)}
                      </span>
                    ) : (
                      "—"
                    );
                  }
                  if (status.kind === "charge-reimbursed") {
                    return (
                      <span>
                        <span className="text-xs text-slate-500">
                          {coaAccountNumber(status.payment.coa_category) ?? 308}{" "}
                          {formatDate(status.payment.entry_date)}
                          {status.mismatch ? " · amount differs" : ""}
                        </span>
                        {reimbursementMaps.duplicateChargeIds.has(entry.id) ? (
                          <span className="mt-0.5 block text-xs text-amber-900">
                            Possible duplicate · {cardChargeOriginNote(entry)}
                          </span>
                        ) : null}
                      </span>
                    );
                  }
                  if (status.kind === "payment-unmatched") {
                    return (
                      <span className="font-medium text-amber-800">
                        Unmatched 308
                      </span>
                    );
                  }
                  if (status.kind === "payment-matched") {
                    return (
                      <span>
                        <span className="text-slate-700">Pays card charge</span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {formatDate(status.charge.entry_date)}
                          {status.mismatch ? " · amount differs" : ""}
                        </span>
                      </span>
                    );
                  }
                  return "—";
                })(),
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
