import {
  coaAccountNumber,
  isInvoiceGoodsLine,
  isLiabilityCoa,
  isOperatingExpenseCoa,
  isOperatingExpenseEntry,
  isOwnerEquityCoa,
  isRecordedTransferCoa,
  isSalesIncomeCoa,
  isTaxesAndLicensesCoa,
} from "@/lib/coa";
import { isCostCompanionRow } from "@/lib/cost-companions";
import { normalizeInvoiceId } from "@/lib/invoice-utils";
import { isPaymentCompanionRow } from "@/lib/payment-companions";
import type { LedgerEntry, Purchaser } from "@/lib/types";
import { getLedgerTotalDesignerCost, roundMoney } from "@/lib/utils";

export type PartnerAmounts = {
  jess: number;
  molly: number;
};

export type TrueUpCategoryRow = {
  category: string;
  amounts: PartnerAmounts;
};

export type TrueUpBlock = {
  id: string;
  groupLabel: string;
  secondaryLabel: string;
  categoryRows: TrueUpCategoryRow[];
  subtotal: PartnerAmounts;
  required: PartnerAmounts;
  recordedRows: TrueUpCategoryRow[];
  recorded: PartnerAmounts;
  discrepancy: PartnerAmounts;
};

export type TrueUpReport = {
  year: number;
  sales: TrueUpBlock[];
  expenses: TrueUpBlock[];
  untaggedTransfers: TrueUpUntaggedTransfer[];
  ytdRequired: PartnerAmounts;
  ytdRecorded: PartnerAmounts;
  ytdDiscrepancy: PartnerAmounts;
};

export type TrueUpUntaggedTransfer = {
  id: string;
  date: string;
  description: string;
  category: string;
  account: string;
  invoiceId: string;
  paidTo: string;
  party: Purchaser;
  amount: number;
};

/** Spreadsheet labels for the true-up report (COA numbers still drive matching). */
export const TRUE_UP_COGS_LABEL = "101 COGS";
export const TRUE_UP_INCOME_LABEL = "100 Sales Income";
export const TRUE_UP_FEES_LABEL = "203 Commissions and Fees";
export const TRUE_UP_TRANSFERS_LABEL = "302 Transfers between accounts";

const ZERO: PartnerAmounts = { jess: 0, molly: 0 };

export function emptyPartnerAmounts(): PartnerAmounts {
  return { ...ZERO };
}

export function partnerTotal(amounts: PartnerAmounts) {
  return roundMoney(amounts.jess + amounts.molly);
}

export function addPartnerAmount(
  amounts: PartnerAmounts,
  party: Purchaser | null | undefined,
  value: number
): PartnerAmounts {
  const next = { ...amounts };
  const amount = roundMoney(value);
  if (!amount) return next;
  if (party === "Molly") next.molly = roundMoney(next.molly + amount);
  else next.jess = roundMoney(next.jess + amount);
  return next;
}

export function sumPartnerAmounts(...groups: PartnerAmounts[]): PartnerAmounts {
  return groups.reduce(
    (acc, group) => ({
      jess: roundMoney(acc.jess + group.jess),
      molly: roundMoney(acc.molly + group.molly),
    }),
    emptyPartnerAmounts()
  );
}

export function subtractPartnerAmounts(
  left: PartnerAmounts,
  right: PartnerAmounts
): PartnerAmounts {
  return {
    jess: roundMoney(left.jess - right.jess),
    molly: roundMoney(left.molly - right.molly),
  };
}

/**
 * Cash each person should send (negative) or receive (positive) so both sides
 * end at half. Sending to the other partner is negative on your column and
 * positive on theirs.
 */
export function requiredTransfers(amounts: PartnerAmounts): PartnerAmounts {
  const half = roundMoney(partnerTotal(amounts) / 2);
  const jess = roundMoney(half - amounts.jess);
  return { jess, molly: roundMoney(-jess) };
}

export function partnerFromAccount(
  account: string | null | undefined
): Purchaser | null {
  const value = account ?? "";
  if (value.includes("Molly")) return "Molly";
  if (value.includes("Jess")) return "Jess";
  return null;
}

export function partnerFromEntry(
  entry: Pick<LedgerEntry, "purchaser" | "paid_to" | "account">,
  prefer: "payer" | "payee" = "payer"
): Purchaser {
  if (prefer === "payee" && (entry.paid_to === "Jess" || entry.paid_to === "Molly")) {
    return entry.paid_to;
  }
  return (
    partnerFromAccount(entry.account) ??
    (entry.purchaser === "Molly" ? "Molly" : "Jess")
  );
}

function otherPartner(party: Purchaser): Purchaser {
  return party === "Molly" ? "Jess" : "Molly";
}

/** CoA names that include both partners, e.g. "303 ... Molly To Jess". */
function isPartnerToPartnerTransferCoa(category: string | null | undefined) {
  const label = (category ?? "").toLowerCase();
  return label.includes("jess") && label.includes("molly");
}

function invoiceKey(entry: Pick<LedgerEntry, "invoice_id">) {
  return normalizeInvoiceId(entry.invoice_id);
}

function invoiceProjectLabel(
  invoiceId: string,
  poNumber?: string | null
) {
  const po = (poNumber ?? "").trim();
  if (po) return po;
  const match = invoiceId.match(/^(.*)-\d+$/);
  return match?.[1] || invoiceId;
}

function inYear(date: string | null | undefined, year: number) {
  return typeof date === "string" && date.startsWith(`${year}-`);
}

function monthKey(date: string | null | undefined) {
  return typeof date === "string" && date.length >= 7 ? date.slice(0, 7) : "";
}

function monthLabel(key: string) {
  if (key.length < 7) return key;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
  }).format(new Date(`${key}-01T12:00:00`));
}

/** Cash-basis amount: deposits/credits positive, payments/debits negative. */
function netCash(entry: Pick<LedgerEntry, "debit_amount" | "credit_amount">) {
  return roundMoney(
    Number(entry.credit_amount ?? 0) - Number(entry.debit_amount ?? 0)
  );
}

function hasAmount(amounts: PartnerAmounts) {
  return Math.abs(amounts.jess) >= 0.005 || Math.abs(amounts.molly) >= 0.005;
}

function recordedRowsFromMap(
  byCategory: Map<string, PartnerAmounts>
): TrueUpCategoryRow[] {
  return [...byCategory.entries()]
    .filter(([, amounts]) => hasAmount(amounts))
    .sort(([a], [b]) => {
      const aNum = coaAccountNumber(a) ?? 999;
      const bNum = coaAccountNumber(b) ?? 999;
      return aNum - bNum || a.localeCompare(b);
    })
    .map(([category, amounts]) => ({
      category,
      amounts,
    }));
}

function finishBlock(
  id: string,
  groupLabel: string,
  secondaryLabel: string,
  categoryRows: TrueUpCategoryRow[],
  subtotal: PartnerAmounts,
  recordedByCategory: Map<string, PartnerAmounts>
): TrueUpBlock {
  const required = requiredTransfers(subtotal);
  const recordedRows = recordedRowsFromMap(recordedByCategory);
  const recorded = recordedRows.reduce(
    (acc, row) => sumPartnerAmounts(acc, row.amounts),
    emptyPartnerAmounts()
  );
  return {
    id,
    groupLabel,
    secondaryLabel,
    categoryRows: categoryRows.filter((row) => hasAmount(row.amounts)),
    subtotal,
    required,
    recordedRows,
    recorded,
    discrepancy: subtractPartnerAmounts(required, recorded),
  };
}

function addToCategoryMap(
  map: Map<string, PartnerAmounts>,
  category: string,
  party: Purchaser,
  amount: number
) {
  if (Math.abs(amount) < 0.005) return;
  map.set(
    category,
    addPartnerAmount(map.get(category) ?? emptyPartnerAmounts(), party, amount)
  );
}

function recordedTransferCounterparty(entry: LedgerEntry): Purchaser | null {
  const owner = partnerFromEntry(entry, "payer");
  if (isPartnerToPartnerTransferCoa(entry.coa_category)) {
    return otherPartner(owner);
  }
  if (
    (entry.paid_to === "Jess" || entry.paid_to === "Molly") &&
    entry.paid_to !== owner
  ) {
    return entry.paid_to;
  }
  return null;
}

function collectUntaggedTransfers(
  entries: LedgerEntry[],
  year: number
): TrueUpUntaggedTransfer[] {
  return entries
    .filter((entry) => {
      if (!inYear(entry.entry_date, year) && !inYear(entry.date_paid, year)) {
        return false;
      }
      if (skipTrueUpShare(entry)) return false;
      if (!isRecordedTransferCoa(entry.coa_category)) return false;
      if (entry.source_ledger_id) return false;
      if (Math.abs(netCash(entry)) < 0.005) return false;
      if (isPartnerToPartnerTransferCoa(entry.coa_category)) return false;
      return entry.paid_to !== "Jess" && entry.paid_to !== "Molly";
    })
    .map((entry) => ({
      id: entry.id,
      date: entry.entry_date,
      description: entry.description?.trim() || "—",
      category: recordedCategoryLabel(entry.coa_category),
      account: entry.account?.trim() || "—",
      invoiceId: invoiceKey(entry),
      paidTo: entry.paid_to?.trim() || "",
      party: partnerFromEntry(entry, "payer"),
      amount: netCash(entry),
    }))
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || a.description.localeCompare(b.description)
    );
}

function addRecordedTransfer(map: Map<string, PartnerAmounts>, entry: LedgerEntry) {
  const amount = netCash(entry);
  if (Math.abs(amount) < 0.005) return;
  const owner = partnerFromEntry(entry, "payer");
  const counterparty = recordedTransferCounterparty(entry);
  if (!counterparty) return;
  const category = recordedCategoryLabel(entry.coa_category);
  addToCategoryMap(map, category, owner, amount);
  addToCategoryMap(map, category, counterparty, -amount);
}

function isPersonalUseTrueUpEntry(
  entry: LedgerEntry,
  parentById: Map<string, LedgerEntry>
): boolean {
  // 203 / 300-series cashflow transfers default to Balance Sheet; they are
  // recorded true-up transfers, not personal-use goods.
  if (isRecordedTransferCoa(entry.coa_category) && !entry.source_ledger_id) {
    return false;
  }
  if (isInvoiceGoodsLine(entry) && entry.balance_sheet) return true;
  if (isCostCompanionRow(entry) && entry.balance_sheet) return true;
  const parentId = entry.source_ledger_id;
  if (!parentId) return false;
  const parent = parentById.get(parentId);
  return Boolean(parent && isInvoiceGoodsLine(parent) && parent.balance_sheet);
}

function skipTrueUpShare(entry: LedgerEntry) {
  return (
    isOwnerEquityCoa(entry.coa_category) ||
    isTaxesAndLicensesCoa(entry.coa_category) ||
    isLiabilityCoa(entry.coa_category)
  );
}

function isSalesTransferRow(entry: LedgerEntry) {
  return (
    isRecordedTransferCoa(entry.coa_category) &&
    Boolean(invoiceKey(entry)) &&
    !entry.source_ledger_id
  );
}

function isExpenseTransferRow(entry: LedgerEntry) {
  return (
    isRecordedTransferCoa(entry.coa_category) &&
    !invoiceKey(entry) &&
    !entry.source_ledger_id
  );
}

function recordedCategoryLabel(category: string | null | undefined) {
  const n = (category ?? "").trim();
  if (n.startsWith("203")) return TRUE_UP_FEES_LABEL;
  if (n.startsWith("302")) return TRUE_UP_TRANSFERS_LABEL;
  return n;
}

function salesSubtotal(
  cogs: PartnerAmounts,
  income: PartnerAmounts
): PartnerAmounts {
  return sumPartnerAmounts(cogs, income);
}

/** Tax, shipping, and fees billed through the invoice — not 50/50 profit. */
function salesIncomePassThrough(
  entry: Pick<
    LedgerEntry,
    "tax_amount" | "shipping_receiving_amount" | "payment_fee"
  >
) {
  return roundMoney(
    Number(entry.tax_amount ?? 0) +
      Number(entry.shipping_receiving_amount ?? 0) +
      Number(entry.payment_fee ?? 0)
  );
}

function netSalesIncome(
  gross: number,
  source: Pick<
    LedgerEntry,
    "tax_amount" | "shipping_receiving_amount" | "payment_fee"
  >
) {
  return roundMoney(gross - salesIncomePassThrough(source));
}

function buildSalesBlocks(
  entries: LedgerEntry[],
  year: number,
  parentById: Map<string, LedgerEntry>
): TrueUpBlock[] {
  const paymentCompanionParentIds = new Set(
    entries
      .filter(isPaymentCompanionRow)
      .map((entry) => entry.source_ledger_id)
      .filter((id): id is string => Boolean(id))
  );

  const byInvoice = new Map<
    string,
    {
      invoiceId: string;
      projectLabel: string;
      cogs: PartnerAmounts;
      income: PartnerAmounts;
      recorded: Map<string, PartnerAmounts>;
    }
  >();

  function group(invoiceId: string, poNumber?: string | null) {
    const existing = byInvoice.get(invoiceId);
    if (existing) {
      if (poNumber && existing.projectLabel === invoiceId) {
        existing.projectLabel = invoiceProjectLabel(invoiceId, poNumber);
      }
      return existing;
    }
    const created = {
      invoiceId,
      projectLabel: invoiceProjectLabel(invoiceId, poNumber),
      cogs: emptyPartnerAmounts(),
      income: emptyPartnerAmounts(),
      recorded: new Map<string, PartnerAmounts>(),
    };
    byInvoice.set(invoiceId, created);
    return created;
  }

  for (const entry of entries) {
    const invoiceId = invoiceKey(entry);
    if (!invoiceId) continue;
    const datedInYear =
      inYear(entry.entry_date, year) || inYear(entry.date_paid, year);
    if (!datedInYear) continue;
    if (skipTrueUpShare(entry)) continue;
    if (isPersonalUseTrueUpEntry(entry, parentById)) continue;

    if (isSalesTransferRow(entry)) {
      addRecordedTransfer(
        group(invoiceId, entry.po_number).recorded,
        entry
      );
      continue;
    }

    if (isCostCompanionRow(entry)) continue;

    if (isPaymentCompanionRow(entry) || isSalesIncomeCoa(entry.coa_category)) {
      const source =
        (entry.source_ledger_id && parentById.get(entry.source_ledger_id)) ||
        entry;
      const income = netSalesIncome(
        Number(entry.credit_amount ?? 0) || Number(entry.payment_amount ?? 0),
        source
      );
      if (income) {
        group(invoiceId, entry.po_number).income = addPartnerAmount(
          group(invoiceId, entry.po_number).income,
          partnerFromEntry(entry, "payee"),
          income
        );
      }
      continue;
    }

    if (entry.source_ledger_id) continue;

    const cogs = -getLedgerTotalDesignerCost(entry);
    const g = group(invoiceId, entry.po_number);
    const party = partnerFromEntry(entry, "payer");
    if (cogs) g.cogs = addPartnerAmount(g.cogs, party, cogs);

    if (
      !paymentCompanionParentIds.has(entry.id) &&
      Number(entry.payment_amount ?? 0) > 0
    ) {
      g.income = addPartnerAmount(
        g.income,
        partnerFromEntry(entry, "payee"),
        netSalesIncome(Number(entry.payment_amount ?? 0), entry)
      );
    }
  }

  return [...byInvoice.values()]
    .map((group) => {
      const categoryRows: TrueUpCategoryRow[] = [
        { category: TRUE_UP_COGS_LABEL, amounts: group.cogs },
        { category: TRUE_UP_INCOME_LABEL, amounts: group.income },
      ];
      return finishBlock(
        `inv:${group.invoiceId}`,
        group.projectLabel,
        group.invoiceId,
        categoryRows,
        salesSubtotal(group.cogs, group.income),
        group.recorded
      );
    })
    .filter(
      (block) =>
        block.categoryRows.some((row) => hasAmount(row.amounts)) ||
        hasAmount(block.recorded) ||
        hasAmount(block.required)
    )
    .sort((a, b) =>
      a.groupLabel.localeCompare(b.groupLabel) ||
      a.secondaryLabel.localeCompare(b.secondaryLabel)
    );
}

function buildExpenseBlocks(
  entries: LedgerEntry[],
  year: number,
  parentById: Map<string, LedgerEntry>
): TrueUpBlock[] {
  const byMonth = new Map<
    string,
    {
      categories: Map<string, PartnerAmounts>;
      recorded: Map<string, PartnerAmounts>;
    }
  >();

  function monthGroup(key: string) {
    const existing = byMonth.get(key);
    if (existing) return existing;
    const created = {
      categories: new Map<string, PartnerAmounts>(),
      recorded: new Map<string, PartnerAmounts>(),
    };
    byMonth.set(key, created);
    return created;
  }

  for (const entry of entries) {
    if (!inYear(entry.entry_date, year)) continue;
    const key = monthKey(entry.entry_date);
    if (!key) continue;
    if (skipTrueUpShare(entry)) continue;
    if (isPersonalUseTrueUpEntry(entry, parentById)) continue;

    if (isExpenseTransferRow(entry)) {
      addRecordedTransfer(monthGroup(key).recorded, entry);
      continue;
    }

    if (!isOperatingExpenseEntry(entry)) continue;
    if (!isOperatingExpenseCoa(entry.coa_category)) continue;
    if (isRecordedTransferCoa(entry.coa_category)) continue;
    if (entry.balance_sheet) continue;

    const amount = netCash(entry);
    if (Math.abs(amount) < 0.005) continue;
    const category = entry.coa_category?.trim() || "Expense";
    addToCategoryMap(
      monthGroup(key).categories,
      category,
      partnerFromEntry(entry, "payer"),
      amount
    );
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, group]) => {
      const categoryRows = [...group.categories.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, amounts]) => ({ category, amounts }));
      const subtotal = categoryRows.reduce(
        (acc, row) => sumPartnerAmounts(acc, row.amounts),
        emptyPartnerAmounts()
      );
      return finishBlock(
        `exp:${key}`,
        monthLabel(key),
        key,
        categoryRows,
        subtotal,
        group.recorded
      );
    })
    .filter(
      (block) =>
        block.categoryRows.length > 0 ||
        hasAmount(block.recorded) ||
        hasAmount(block.required)
    );
}

export function buildTrueUpReport(
  entries: LedgerEntry[],
  year: number
): TrueUpReport {
  const parentById = new Map(entries.map((entry) => [entry.id, entry]));
  const sales = buildSalesBlocks(entries, year, parentById);
  const expenses = buildExpenseBlocks(entries, year, parentById);
  const ytdRequired = sumPartnerAmounts(
    ...sales.map((block) => block.required),
    ...expenses.map((block) => block.required)
  );
  const ytdRecorded = sumPartnerAmounts(
    ...sales.map((block) => block.recorded),
    ...expenses.map((block) => block.recorded)
  );

  return {
    year,
    sales,
    expenses,
    untaggedTransfers: collectUntaggedTransfers(entries, year),
    ytdRequired,
    ytdRecorded,
    ytdDiscrepancy: subtractPartnerAmounts(ytdRequired, ytdRecorded),
  };
}
