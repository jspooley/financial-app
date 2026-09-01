import {
  coaAccountNumber,
  isBusinessLoanPaybackCoa,
  isInvoiceGoodsLine,
  isLiabilityCoa,
  isOperatingExpenseCoa,
  isOperatingExpenseEntry,
  isOwnerEquityCoa,
  isPartnerToPartnerTransferCoa,
  isPersonalCardReimbursementCoa,
  isRecordedTransferCoa,
  isSalesIncomeCoa,
  isTaxesAndLicensesCoa,
} from "@/lib/coa";
import { isCostCompanionRow } from "@/lib/cost-companions";
import {
  jobKeysByStatus,
  ledgerJobKey,
  normalizeInvoiceId,
} from "@/lib/invoice-utils";
import { isPaymentCompanionRow } from "@/lib/payment-companions";
import type { LedgerEntry, Purchaser } from "@/lib/types";
import { getLedgerTotalDesignerCost, roundMoney } from "@/lib/utils";

export type PartnerAmounts = {
  jess: number;
  molly: number;
};

export type TrueUpTransaction = {
  id: string;
  date: string;
  description: string;
  account: string;
  invoiceId: string;
  party: Purchaser;
  amount: number;
};

export type TrueUpCategoryRow = {
  category: string;
  amounts: PartnerAmounts;
  transactions?: TrueUpTransaction[];
};

export type TrueUpBlock = {
  id: string;
  groupLabel: string;
  secondaryLabel: string;
  status?: "pending";
  categoryRows: TrueUpCategoryRow[];
  subtotal: PartnerAmounts;
  required: PartnerAmounts;
  recordedRows: TrueUpCategoryRow[];
  recorded: PartnerAmounts;
  discrepancy: PartnerAmounts;
};

export type TrueUpYtdTotals = {
  required: PartnerAmounts;
  recorded: PartnerAmounts;
  discrepancy: PartnerAmounts;
};

export type TrueUpReport = {
  year: number;
  sales: TrueUpBlock[];
  expenses: TrueUpBlock[];
  untaggedTransfers: TrueUpUntaggedTransfer[];
  ytdSales: TrueUpYtdTotals;
  ytdExpenses: TrueUpYtdTotals;
  ytdGrandTotal: TrueUpYtdTotals;
  ytdJessToMolly: number;
  ytdMollyToJess: number;
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

/**
 * Categories and row types left out of the 50/50 true-up. Keep this in sync
 * with skipTrueUpShare, isPersonalUseTrueUpEntry, and salesIncomePassThrough.
 */
export const TRUE_UP_EXCLUSIONS: { label: string; detail: string }[] = [
  {
    label: "300 / 310 Owner's contributions",
    detail:
      "Capital put into the business. Tracked on Business Debt, not split 50/50.",
  },
  {
    label: "301 / 302 Owner's draws",
    detail: "Taking profit out is equity, not a transfer to the other partner.",
  },
  {
    label: "305 / 306 Business loan paybacks",
    detail:
      "Paying back a loan from an owner. Tracked on Business Debt, not a 50/50 share.",
  },
  {
    label: "308 Reimburse personal credit card",
    detail:
      "Paying your own card from checking is not a partner-to-partner transfer.",
  },
  {
    label: "214 Taxes and licenses",
    detail: "Remitted to the state, not shared between partners.",
  },
  {
    label: "400-series liabilities (S&U tax payable)",
    detail: "Tax collected for the state. Cash moves through them, but they are not shared.",
  },
  {
    label: "Personal-use goods (Balance Sheet invoice lines)",
    detail:
      "Invoice lines marked personal use, plus their payment and cost companions.",
  },
  {
    label: "Sales & use tax collected on invoices",
    detail:
      "Stripped from 100 Sales Income as pass-through to the state. Shipping and payment fees stay in sales income and are reimbursed to whoever paid them.",
  },
];

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

/**
 * After attributing purchases to the purchaser and client payments to the
 * payee, equalize profit only. Costs are fully reimbursed; profit is split
 * 50/50.
 */
export function requiredProfitTransfers(
  costs: PartnerAmounts,
  income: PartnerAmounts
): PartnerAmounts {
  const position = sumPartnerAmounts(costs, income);
  const profit = partnerTotal(position);
  const halfProfit = roundMoney(profit / 2);
  const jess = roundMoney(halfProfit - position.jess);
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

function invoiceKey(entry: Pick<LedgerEntry, "invoice_id">) {
  return normalizeInvoiceId(entry.invoice_id);
}

function trueUpTransactionFromEntry(
  entry: LedgerEntry,
  party: Purchaser,
  amount: number,
  date = entry.entry_date
): TrueUpTransaction {
  return {
    id: entry.id,
    date,
    description:
      entry.description?.trim() ||
      entry.clients?.name?.trim() ||
      "—",
    account: entry.account?.trim() || "—",
    invoiceId: invoiceKey(entry),
    party,
    amount,
  };
}

function sortTrueUpTransactions(transactions: TrueUpTransaction[]) {
  return [...transactions].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.description.localeCompare(b.description)
  );
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
  recordedByCategory: Map<string, PartnerAmounts>,
  requiredOverride?: PartnerAmounts
): TrueUpBlock {
  const required = requiredOverride ?? requiredTransfers(subtotal);
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
    isPersonalCardReimbursementCoa(entry.coa_category) ||
    isBusinessLoanPaybackCoa(entry.coa_category) ||
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

/** Sales & use tax collected on the invoice — remitted to the state, not profit. */
function salesIncomePassThrough(
  entry: Pick<LedgerEntry, "tax_amount">
) {
  return roundMoney(Number(entry.tax_amount ?? 0));
}

function netSalesIncome(
  gross: number,
  source: Pick<LedgerEntry, "tax_amount">
) {
  return roundMoney(gross - salesIncomePassThrough(source));
}

function addCostToGroup(
  group: {
    cogs: PartnerAmounts;
    cogsTransactions: TrueUpTransaction[];
  },
  entry: LedgerEntry,
  amount: number
) {
  if (Math.abs(amount) < 0.005) return;
  const party = partnerFromEntry(entry, "payer");
  group.cogs = addPartnerAmount(group.cogs, party, amount);
  group.cogsTransactions.push(trueUpTransactionFromEntry(entry, party, amount));
}

function jobHasPurchaseOrPayment(
  entries: LedgerEntry[],
  jobKey: string,
  parentById: Map<string, LedgerEntry>
) {
  for (const entry of entries) {
    if (skipTrueUpShare(entry)) continue;
    if (isPersonalUseTrueUpEntry(entry, parentById)) continue;
    if (ledgerJobKey(entry.client_id, entry.po_number) !== jobKey) continue;

    if (isPaymentCompanionRow(entry)) return true;
    if (Number(entry.payment_amount ?? 0) > 0) return true;
    if (isCostCompanionRow(entry) && Number(entry.debit_amount ?? 0) > 0) {
      return true;
    }
    if (entry.source_ledger_id) continue;
    if (getLedgerTotalDesignerCost(entry) > 0) return true;
  }
  return false;
}

function buildPendingSalesBlocks(
  entries: LedgerEntry[],
  parentById: Map<string, LedgerEntry>,
  activeInvoiceIds: Set<string>
): TrueUpBlock[] {
  const { open } = jobKeysByStatus(entries);
  const pending: TrueUpBlock[] = [];

  for (const jobKey of open) {
    if (jobHasPurchaseOrPayment(entries, jobKey, parentById)) continue;

    const jobEntries = entries.filter(
      (entry) => ledgerJobKey(entry.client_id, entry.po_number) === jobKey
    );
    if (jobEntries.length === 0) continue;

    const poNumber =
      jobEntries.find((entry) => entry.po_number?.trim())?.po_number?.trim() ||
      jobKey.split(":").slice(1).join(":") ||
      jobKey;
    const invoiceId =
      jobEntries
        .map((entry) => invoiceKey(entry))
        .find((id) => id && !activeInvoiceIds.has(id)) ?? `pending:${jobKey}`;

    if (activeInvoiceIds.has(invoiceId)) continue;

    pending.push({
      id: `pending:${jobKey}`,
      groupLabel: poNumber,
      secondaryLabel: "Pending",
      status: "pending",
      categoryRows: [],
      subtotal: emptyPartnerAmounts(),
      required: emptyPartnerAmounts(),
      recordedRows: [],
      recorded: emptyPartnerAmounts(),
      discrepancy: emptyPartnerAmounts(),
    });
  }

  return pending.sort(
    (a, b) =>
      a.groupLabel.localeCompare(b.groupLabel) ||
      a.secondaryLabel.localeCompare(b.secondaryLabel)
  );
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
      cogsTransactions: TrueUpTransaction[];
      incomeTransactions: TrueUpTransaction[];
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
      cogsTransactions: [] as TrueUpTransaction[],
      incomeTransactions: [] as TrueUpTransaction[],
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

    if (isCostCompanionRow(entry)) {
      addCostToGroup(
        group(invoiceId, entry.po_number),
        entry,
        -Number(entry.debit_amount ?? 0)
      );
      continue;
    }

    if (isPaymentCompanionRow(entry) || isSalesIncomeCoa(entry.coa_category)) {
      const source =
        (entry.source_ledger_id && parentById.get(entry.source_ledger_id)) ||
        entry;
      const income = netSalesIncome(
        Number(entry.credit_amount ?? 0) || Number(entry.payment_amount ?? 0),
        source
      );
      if (income) {
        const g = group(invoiceId, entry.po_number);
        const party = partnerFromEntry(entry, "payee");
        g.income = addPartnerAmount(g.income, party, income);
        g.incomeTransactions.push(
          trueUpTransactionFromEntry(
            entry,
            party,
            income,
            entry.date_paid || entry.entry_date
          )
        );
      }
      continue;
    }

    if (entry.source_ledger_id) continue;

    const cogs = -getLedgerTotalDesignerCost(entry);
    const g = group(invoiceId, entry.po_number);
    if (cogs) {
      addCostToGroup(g, entry, cogs);
    }

    if (
      !paymentCompanionParentIds.has(entry.id) &&
      Number(entry.payment_amount ?? 0) > 0
    ) {
      const income = netSalesIncome(Number(entry.payment_amount ?? 0), entry);
      if (income) {
        const payee = partnerFromEntry(entry, "payee");
        g.income = addPartnerAmount(g.income, payee, income);
        g.incomeTransactions.push(
          trueUpTransactionFromEntry(
            entry,
            payee,
            income,
            entry.date_paid || entry.entry_date
          )
        );
      }
    }
  }

  const activeBlocks = [...byInvoice.values()]
    .map((group) => {
      const categoryRows: TrueUpCategoryRow[] = [
        {
          category: TRUE_UP_COGS_LABEL,
          amounts: group.cogs,
          transactions: sortTrueUpTransactions(group.cogsTransactions),
        },
        {
          category: TRUE_UP_INCOME_LABEL,
          amounts: group.income,
          transactions: sortTrueUpTransactions(group.incomeTransactions),
        },
      ];
      return finishBlock(
        `inv:${group.invoiceId}`,
        group.projectLabel,
        group.invoiceId,
        categoryRows,
        salesSubtotal(group.cogs, group.income),
        group.recorded,
        requiredProfitTransfers(group.cogs, group.income)
      );
    })
    .filter(
      (block) =>
        block.categoryRows.some((row) => hasAmount(row.amounts)) ||
        hasAmount(block.recorded) ||
        hasAmount(block.required)
    );

  const activeInvoiceIds = new Set(
    activeBlocks.map((block) => block.secondaryLabel).filter(Boolean)
  );
  const pending = buildPendingSalesBlocks(entries, parentById, activeInvoiceIds);

  return [...activeBlocks, ...pending].sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return 1;
    if (b.status === "pending" && a.status !== "pending") return -1;
    return (
      a.groupLabel.localeCompare(b.groupLabel) ||
      a.secondaryLabel.localeCompare(b.secondaryLabel)
    );
  });
}

type ExpenseCategoryBucket = {
  amounts: PartnerAmounts;
  transactions: TrueUpTransaction[];
};

function buildExpenseBlocks(
  entries: LedgerEntry[],
  year: number,
  parentById: Map<string, LedgerEntry>
): TrueUpBlock[] {
  const byMonth = new Map<
    string,
    {
      categories: Map<string, ExpenseCategoryBucket>;
      recorded: Map<string, PartnerAmounts>;
    }
  >();

  function monthGroup(key: string) {
    const existing = byMonth.get(key);
    if (existing) return existing;
    const created = {
      categories: new Map<string, ExpenseCategoryBucket>(),
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
    const party = partnerFromEntry(entry, "payer");
    const group = monthGroup(key);
    const bucket = group.categories.get(category) ?? {
      amounts: emptyPartnerAmounts(),
      transactions: [],
    };
    bucket.amounts = addPartnerAmount(bucket.amounts, party, amount);
    bucket.transactions.push(trueUpTransactionFromEntry(entry, party, amount));
    group.categories.set(category, bucket);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, group]) => {
      const categoryRows = [...group.categories.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, bucket]) => ({
          category,
          amounts: bucket.amounts,
          transactions: sortTrueUpTransactions(bucket.transactions),
        }));
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

function ytdTotalsFromBlocks(blocks: TrueUpBlock[]): TrueUpYtdTotals {
  const required = sumPartnerAmounts(...blocks.map((block) => block.required));
  const recorded = sumPartnerAmounts(...blocks.map((block) => block.recorded));
  return {
    required,
    recorded,
    discrepancy: subtractPartnerAmounts(required, recorded),
  };
}

function recordedPartnerFlows(entries: LedgerEntry[], year: number) {
  let jessToMolly = 0;
  let mollyToJess = 0;
  for (const entry of entries) {
    if (!inYear(entry.entry_date, year) && !inYear(entry.date_paid, year)) {
      continue;
    }
    if (entry.source_ledger_id) continue;
    if (!isRecordedTransferCoa(entry.coa_category)) continue;
    if (skipTrueUpShare(entry)) continue;
    const counterparty = recordedTransferCounterparty(entry);
    if (!counterparty) continue;
    const amount = netCash(entry);
    if (Math.abs(amount) < 0.005) continue;
    const owner = partnerFromEntry(entry, "payer");
    const from = amount < 0 ? owner : counterparty;
    const to = amount < 0 ? counterparty : owner;
    const moved = roundMoney(Math.abs(amount));
    if (from === "Jess" && to === "Molly") jessToMolly += moved;
    if (from === "Molly" && to === "Jess") mollyToJess += moved;
  }
  return {
    jessToMolly: roundMoney(jessToMolly),
    mollyToJess: roundMoney(mollyToJess),
  };
}

export function buildTrueUpReport(
  entries: LedgerEntry[],
  year: number
): TrueUpReport {
  const parentById = new Map(entries.map((entry) => [entry.id, entry]));
  const sales = buildSalesBlocks(entries, year, parentById);
  const expenses = buildExpenseBlocks(entries, year, parentById);
  const ytdSales = ytdTotalsFromBlocks(sales);
  const ytdExpenses = ytdTotalsFromBlocks(expenses);
  const flows = recordedPartnerFlows(entries, year);

  return {
    year,
    sales,
    expenses,
    untaggedTransfers: collectUntaggedTransfers(entries, year),
    ytdSales,
    ytdExpenses,
    ytdGrandTotal: {
      required: sumPartnerAmounts(ytdSales.required, ytdExpenses.required),
      recorded: sumPartnerAmounts(ytdSales.recorded, ytdExpenses.recorded),
      discrepancy: sumPartnerAmounts(
        ytdSales.discrepancy,
        ytdExpenses.discrepancy
      ),
    },
    ytdJessToMolly: flows.jessToMolly,
    ytdMollyToJess: flows.mollyToJess,
  };
}
