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
  isInvoicedDebitLine,
  isLedgerLineFullyPaid,
  jobKeysByStatus,
  ledgerJobKey,
  normalizeInvoiceId,
} from "@/lib/invoice-utils";
import { isPaymentCompanionRow } from "@/lib/payment-companions";
import type { LedgerEntry, KnownPurchaser, Purchaser } from "@/lib/types";
import { isKnownPurchaser, isPendingPurchase } from "@/lib/types";
import {
  getLedgerInvoicedAmountExcludingPaymentFee,
  getLedgerTotalDesignerCost,
  roundMoney,
} from "@/lib/utils";

export type PartnerAmounts = {
  jess: number;
  molly: number;
  tbd: number;
};

export type TrueUpTransaction = {
  id: string;
  date: string;
  description: string;
  account: string;
  invoiceId: string;
  party: Purchaser;
  amount: number;
  excluded?: boolean;
  excludeReason?: string;
};

export type TrueUpCategoryRow = {
  category: string;
  amounts: PartnerAmounts;
  transactions?: TrueUpTransaction[];
};

export type TrueUpPendingReason = "no_activity" | "awaiting_payment";

export type TrueUpBlock = {
  id: string;
  groupLabel: string;
  secondaryLabel: string;
  status?: "pending";
  pendingReason?: TrueUpPendingReason;
  categoryRows: TrueUpCategoryRow[];
  subtotal: PartnerAmounts;
  required: PartnerAmounts;
  recordedRows: TrueUpCategoryRow[];
  recorded: PartnerAmounts;
  discrepancy: PartnerAmounts;
  /** Invoiced sales income before client payment (awaiting_payment blocks only). */
  projectedCategoryRows?: TrueUpCategoryRow[];
  projectedSubtotal?: PartnerAmounts;
  projectedRequired?: PartnerAmounts;
  /** Invoiced income is unassigned; required partner split is not knowable yet. */
  projectedPayeeUnknown?: boolean;
};

export type TrueUpYtdTotals = {
  required: PartnerAmounts;
  recorded: PartnerAmounts;
  discrepancy: PartnerAmounts;
  /** Invoiced income and unpurchased COGS not yet assigned to Jess or Molly. */
  unassigned: PartnerAmounts;
};

export type TrueUpGroupBy = "month" | "coa";

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
export const TRUE_UP_PROJECTED_INCOME_LABEL = "100 Sales Income (invoiced)";
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
      "Stripped from 100 Sales Income as pass-through to the state. Shipping, receiving, and payment fees are reimbursed to whoever paid them.",
  },
];

const ZERO: PartnerAmounts = { jess: 0, molly: 0, tbd: 0 };

export function emptyPartnerAmounts(): PartnerAmounts {
  return { ...ZERO };
}

export function partnerTotal(amounts: PartnerAmounts) {
  return roundMoney(amounts.jess + amounts.molly + amounts.tbd);
}

export function knownPartnerTotal(amounts: PartnerAmounts) {
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
  else if (party === "Jess") next.jess = roundMoney(next.jess + amount);
  else next.tbd = roundMoney(next.tbd + amount);
  return next;
}

export function sumPartnerAmounts(...groups: PartnerAmounts[]): PartnerAmounts {
  return groups.reduce(
    (acc, group) => ({
      jess: roundMoney(acc.jess + group.jess),
      molly: roundMoney(acc.molly + group.molly),
      tbd: roundMoney(acc.tbd + group.tbd),
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
    tbd: roundMoney(left.tbd - right.tbd),
  };
}

/**
 * Cash each person should send (negative) or receive (positive) so both sides
 * end at half. Sending to the other partner is negative on your column and
 * positive on theirs.
 */
export function requiredTransfers(amounts: PartnerAmounts): PartnerAmounts {
  const half = roundMoney(knownPartnerTotal(amounts) / 2);
  const jess = roundMoney(half - amounts.jess);
  return { jess, molly: roundMoney(-jess), tbd: 0 };
}

/**
 * After attributing purchases to the purchaser and client payments to the
 * payee, equalize profit only. Costs are fully reimbursed; profit is split
 * 50/50. When there is no profit yet (costs exceed income), reimburse each
 * partner's purchases in full instead of splitting the shortfall 50/50.
 */
export function requiredProfitTransfers(
  costs: PartnerAmounts,
  income: PartnerAmounts
): PartnerAmounts {
  if (Math.abs(income.tbd) >= 0.005 || Math.abs(costs.tbd) >= 0.005) {
    return emptyPartnerAmounts();
  }

  const position = sumPartnerAmounts(costs, income);
  const profit = partnerTotal(position);

  if (profit > 0) {
    const halfProfit = roundMoney(profit / 2);
    const jess = roundMoney(halfProfit - position.jess);
    return { jess, molly: roundMoney(-jess), tbd: 0 };
  }

  const netToMolly = roundMoney(-costs.molly + costs.jess);
  return { molly: netToMolly, jess: roundMoney(-netToMolly), tbd: 0 };
}

export function partnerFromAccount(
  account: string | null | undefined
): KnownPurchaser | null {
  const value = account ?? "";
  if (value === "TBD") return null;
  if (value.includes("Molly")) return "Molly";
  if (value.includes("Jess")) return "Jess";
  return null;
}

export function partnerFromEntry(
  entry: Pick<LedgerEntry, "purchaser" | "paid_to" | "account">,
  prefer: "payer" | "payee" = "payer"
): Purchaser {
  if (prefer === "payee" && isKnownPurchaser(entry.paid_to)) {
    return entry.paid_to;
  }
  const fromAccount = partnerFromAccount(entry.account);
  if (fromAccount) return fromAccount;
  if (entry.purchaser === "Molly") return "Molly";
  if (entry.purchaser === "Jess") return "Jess";
  if (entry.purchaser === "TBD" || entry.account === "TBD") return "TBD";
  return "Jess";
}

export function knownPartnerFromEntry(
  entry: Pick<LedgerEntry, "purchaser" | "paid_to" | "account">,
  prefer: "payer" | "payee" = "payer"
): KnownPurchaser {
  const party = partnerFromEntry(entry, prefer);
  return isKnownPurchaser(party) ? party : "Jess";
}

function otherPartner(party: KnownPurchaser): KnownPurchaser {
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
    excluded: isExcludedFromTrueUp(entry),
    excludeReason: (entry.true_up_exclude_reason ?? "").trim() || undefined,
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
  return (
    Math.abs(amounts.jess) >= 0.005 ||
    Math.abs(amounts.molly) >= 0.005 ||
    Math.abs(amounts.tbd) >= 0.005
  );
}

function compareCoaLabels(a: string, b: string) {
  const aNum = coaAccountNumber(a) ?? 999;
  const bNum = coaAccountNumber(b) ?? 999;
  return aNum - bNum || a.localeCompare(b);
}

function recordedRowsFromMap(
  byCategory: Map<string, PartnerAmounts>
): TrueUpCategoryRow[] {
  return [...byCategory.entries()]
    .filter(([, amounts]) => hasAmount(amounts))
    .sort(([a], [b]) => compareCoaLabels(a, b))
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
    categoryRows: categoryRows.filter(
      (row) => hasAmount(row.amounts) || (row.transactions?.length ?? 0) > 0
    ),
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
    return isKnownPurchaser(owner) ? otherPartner(owner) : null;
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
  if (isExcludedFromTrueUp(entry)) return;
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

export function isExcludedFromTrueUp(
  entry: Pick<LedgerEntry, "true_up_eligible">
) {
  return entry.true_up_eligible === false;
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
  const party = isPendingPurchase(entry)
    ? "TBD"
    : partnerFromEntry(entry, "payer");
  const transaction = trueUpTransactionFromEntry(entry, party, amount);
  group.cogsTransactions.push(transaction);
  if (!transaction.excluded) {
    group.cogs = addPartnerAmount(group.cogs, party, amount);
  }
}

function addIncomeToGroup(
  group: {
    income: PartnerAmounts;
    incomeTransactions: TrueUpTransaction[];
  },
  entry: LedgerEntry,
  party: Purchaser,
  income: number,
  date?: string
) {
  if (Math.abs(income) < 0.005) return;
  const transaction = trueUpTransactionFromEntry(entry, party, income, date);
  group.incomeTransactions.push(transaction);
  if (!transaction.excluded) {
    group.income = addPartnerAmount(group.income, party, income);
  }
}

/** Wholesale use tax paid on purchase — reimbursed to purchaser like other COGS. */
function wholesalePurchaseTax(
  entry: Pick<LedgerEntry, "wholesale_retail" | "tax_amount">
) {
  if (entry.wholesale_retail !== "wholesale") return 0;
  return roundMoney(Number(entry.tax_amount ?? 0));
}

function hasClientPayment(income: PartnerAmounts) {
  return hasAmount(income);
}

function invoiceLineCountsForTrueUp(
  entry: LedgerEntry,
  invoiceId: string,
  parentById: Map<string, LedgerEntry>
) {
  if (invoiceKey(entry) !== invoiceId) return false;
  if (entry.source_ledger_id) return false;
  if (!isInvoicedDebitLine(entry)) return false;
  if (skipTrueUpShare(entry)) return false;
  if (isPersonalUseTrueUpEntry(entry, parentById)) return false;
  return true;
}

/** Invoice is closed: every true-up line is paid in full, including by accepted variance. */
function invoiceSettledForTrueUp(
  entries: LedgerEntry[],
  invoiceId: string,
  parentById: Map<string, LedgerEntry>
) {
  let sawLine = false;
  for (const entry of entries) {
    if (!invoiceLineCountsForTrueUp(entry, invoiceId, parentById)) continue;
    sawLine = true;
    if (!isLedgerLineFullyPaid(entry)) return false;
  }
  return sawLine;
}

function collectInvoicedIncome(
  entries: LedgerEntry[],
  invoiceId: string,
  parentById: Map<string, LedgerEntry>
): { amounts: PartnerAmounts; transactions: TrueUpTransaction[] } {
  let amounts = emptyPartnerAmounts();
  const transactions: TrueUpTransaction[] = [];
  for (const entry of entries) {
    if (!invoiceLineCountsForTrueUp(entry, invoiceId, parentById)) continue;

    const gross = getLedgerInvoicedAmountExcludingPaymentFee(entry);
    const net = netSalesIncome(gross, entry);
    if (!net) continue;
    const transaction = trueUpTransactionFromEntry(
      entry,
      "TBD",
      net,
      entry.date_paid || entry.entry_date
    );
    transactions.push(transaction);
    if (!transaction.excluded) {
      amounts = addPartnerAmount(amounts, "TBD", net);
    }
  }
  return {
    amounts,
    transactions: sortTrueUpTransactions(transactions),
  };
}

function cogsAmountsFromBlock(block: TrueUpBlock): PartnerAmounts {
  return (
    block.categoryRows.find((row) => row.category === TRUE_UP_COGS_LABEL)
      ?.amounts ?? emptyPartnerAmounts()
  );
}

function awaitingClientPaymentBlock(
  block: TrueUpBlock,
  projectedIncome: { amounts: PartnerAmounts; transactions: TrueUpTransaction[] },
  reason: TrueUpPendingReason = "awaiting_payment"
): TrueUpBlock {
  const cogs = cogsAmountsFromBlock(block);
  const projectedCategoryRows: TrueUpCategoryRow[] =
    hasAmount(projectedIncome.amounts) || projectedIncome.transactions.length > 0
      ? [
          {
            category: TRUE_UP_PROJECTED_INCOME_LABEL,
            amounts: projectedIncome.amounts,
            transactions: projectedIncome.transactions,
          },
        ]
      : [];
  const projectedSubtotal = salesSubtotal(cogs, projectedIncome.amounts);
  const projectedRequired = requiredProfitTransfers(
    cogs,
    projectedIncome.amounts
  );

  return {
    ...block,
    status: "pending",
    pendingReason: reason,
    required: emptyPartnerAmounts(),
    discrepancy: subtractPartnerAmounts(emptyPartnerAmounts(), block.recorded),
    projectedCategoryRows,
    projectedSubtotal,
    projectedRequired,
    projectedPayeeUnknown: true,
  };
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
      pendingReason: "no_activity",
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
        addIncomeToGroup(
          g,
          entry,
          partnerFromEntry(entry, "payee"),
          income,
          entry.date_paid || entry.entry_date
        );
      }
      continue;
    }

    if (entry.source_ledger_id) continue;

    const g = group(invoiceId, entry.po_number);
    const cogs = -getLedgerTotalDesignerCost(entry);
    if (cogs) {
      addCostToGroup(g, entry, cogs);
    }

    const wholesaleTax = -wholesalePurchaseTax(entry);
    if (wholesaleTax) {
      addCostToGroup(g, entry, wholesaleTax);
    }

    if (
      !paymentCompanionParentIds.has(entry.id) &&
      Number(entry.payment_amount ?? 0) > 0
    ) {
      const income = netSalesIncome(Number(entry.payment_amount ?? 0), entry);
      if (income) {
        addIncomeToGroup(
          g,
          entry,
          partnerFromEntry(entry, "payee"),
          income,
          entry.date_paid || entry.entry_date
        );
      }
    }
  }

  const activeBlocks = [...byInvoice.values()]
    .map((group) => {
      const invoiceSettled = invoiceSettledForTrueUp(
        entries,
        group.invoiceId,
        parentById
      );

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
      const block = finishBlock(
        `inv:${group.invoiceId}`,
        group.projectLabel,
        group.invoiceId,
        categoryRows,
        salesSubtotal(group.cogs, group.income),
        group.recorded,
        requiredProfitTransfers(group.cogs, group.income)
      );
      if (
        !hasClientPayment(group.income) &&
        hasAmount(group.cogs) &&
        !invoiceSettled
      ) {
        const projectedIncome = collectInvoicedIncome(
          entries,
          group.invoiceId,
          parentById
        );
        return awaitingClientPaymentBlock(block, projectedIncome);
      }
      return block;
    })
    .filter(
      (block) =>
        block.status === "pending" ||
        block.categoryRows.length > 0 ||
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

type ExpenseActivityLine = {
  month: string;
  category: string;
  party: Purchaser;
  amount: number;
  transaction: TrueUpTransaction;
};

function emptyExpenseBucket(): ExpenseCategoryBucket {
  return { amounts: emptyPartnerAmounts(), transactions: [] };
}

function addExpenseToBucket(
  bucket: ExpenseCategoryBucket,
  party: Purchaser,
  amount: number,
  transaction: TrueUpTransaction
) {
  bucket.transactions.push(transaction);
  if (!transaction.excluded) {
    bucket.amounts = addPartnerAmount(bucket.amounts, party, amount);
  }
}

function collectExpenseActivity(
  entries: LedgerEntry[],
  year: number,
  parentById: Map<string, LedgerEntry>
) {
  const lines: ExpenseActivityLine[] = [];
  const recordedByMonth = new Map<string, Map<string, PartnerAmounts>>();

  function recordedForMonth(key: string) {
    const existing = recordedByMonth.get(key);
    if (existing) return existing;
    const created = new Map<string, PartnerAmounts>();
    recordedByMonth.set(key, created);
    return created;
  }

  for (const entry of entries) {
    if (!inYear(entry.entry_date, year)) continue;
    const key = monthKey(entry.entry_date);
    if (!key) continue;
    if (skipTrueUpShare(entry)) continue;
    if (isPersonalUseTrueUpEntry(entry, parentById)) continue;

    if (isExpenseTransferRow(entry)) {
      addRecordedTransfer(recordedForMonth(key), entry);
      continue;
    }

    if (!isOperatingExpenseEntry(entry)) continue;
    if (!isOperatingExpenseCoa(entry.coa_category)) continue;
    if (isRecordedTransferCoa(entry.coa_category)) continue;
    if (entry.balance_sheet) continue;

    const amount = netCash(entry);
    if (Math.abs(amount) < 0.005) continue;
    if (isPendingPurchase(entry)) continue;
    const category = entry.coa_category?.trim() || "Expense";
    const party = partnerFromEntry(entry, "payer");
    lines.push({
      month: key,
      category,
      party,
      amount,
      transaction: trueUpTransactionFromEntry(entry, party, amount),
    });
  }

  return { lines, recordedByMonth };
}

function expenseBlocksByMonth(
  lines: ExpenseActivityLine[],
  recordedByMonth: Map<string, Map<string, PartnerAmounts>>
): TrueUpBlock[] {
  const byMonth = new Map<string, Map<string, ExpenseCategoryBucket>>();

  for (const line of lines) {
    const categories =
      byMonth.get(line.month) ?? new Map<string, ExpenseCategoryBucket>();
    const bucket = categories.get(line.category) ?? emptyExpenseBucket();
    addExpenseToBucket(bucket, line.party, line.amount, line.transaction);
    categories.set(line.category, bucket);
    byMonth.set(line.month, categories);
  }

  const monthKeys = new Set([...byMonth.keys(), ...recordedByMonth.keys()]);

  return [...monthKeys]
    .sort((a, b) => b.localeCompare(a))
    .map((key) => {
      const categories = byMonth.get(key) ?? new Map();
      const categoryRows = [...categories.entries()]
        .sort(([a], [b]) => compareCoaLabels(a, b))
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
        recordedByMonth.get(key) ?? new Map()
      );
    })
    .filter(
      (block) =>
        block.categoryRows.length > 0 ||
        hasAmount(block.recorded) ||
        hasAmount(block.required)
    );
}

function expenseBlocksByCoa(lines: ExpenseActivityLine[]): TrueUpBlock[] {
  const byCategory = new Map<string, Map<string, ExpenseCategoryBucket>>();

  for (const line of lines) {
    const months =
      byCategory.get(line.category) ?? new Map<string, ExpenseCategoryBucket>();
    const bucket = months.get(line.month) ?? emptyExpenseBucket();
    addExpenseToBucket(bucket, line.party, line.amount, line.transaction);
    months.set(line.month, bucket);
    byCategory.set(line.category, months);
  }

  return [...byCategory.entries()]
    .sort(([a], [b]) => compareCoaLabels(a, b))
    .map(([category, months]) => {
      const monthRows = [...months.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([key, bucket]) => ({
          category: monthLabel(key),
          amounts: bucket.amounts,
          transactions: sortTrueUpTransactions(bucket.transactions),
        }));
      const subtotal = monthRows.reduce(
        (acc, row) => sumPartnerAmounts(acc, row.amounts),
        emptyPartnerAmounts()
      );
      return finishBlock(
        `exp-coa:${category}`,
        category,
        "",
        monthRows,
        subtotal,
        new Map()
      );
    })
    .filter((block) => block.categoryRows.length > 0);
}

function buildExpenseBlocks(
  entries: LedgerEntry[],
  year: number,
  parentById: Map<string, LedgerEntry>,
  groupBy: TrueUpGroupBy = "month"
): TrueUpBlock[] {
  const { lines, recordedByMonth } = collectExpenseActivity(
    entries,
    year,
    parentById
  );
  if (groupBy === "coa") return expenseBlocksByCoa(lines);
  return expenseBlocksByMonth(lines, recordedByMonth);
}

function unassignedFromBlocks(blocks: TrueUpBlock[]): PartnerAmounts {
  let tbd = 0;
  for (const block of blocks) {
    for (const row of block.categoryRows) {
      tbd = roundMoney(tbd + row.amounts.tbd);
    }
    for (const row of block.projectedCategoryRows ?? []) {
      tbd = roundMoney(tbd + row.amounts.tbd);
    }
  }
  return { jess: 0, molly: 0, tbd };
}

function ytdTotalsFromBlocks(blocks: TrueUpBlock[]): TrueUpYtdTotals {
  const settled = blocks.filter((block) => block.status !== "pending");
  const required = sumPartnerAmounts(...settled.map((block) => block.required));
  const recorded = sumPartnerAmounts(...settled.map((block) => block.recorded));
  return {
    required,
    recorded,
    discrepancy: subtractPartnerAmounts(required, recorded),
    unassigned: unassignedFromBlocks(blocks),
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
    if (isExcludedFromTrueUp(entry)) continue;
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
  year: number,
  groupBy: TrueUpGroupBy = "month"
): TrueUpReport {
  const parentById = new Map(entries.map((entry) => [entry.id, entry]));
  const sales = buildSalesBlocks(entries, year, parentById);
  const expensesByMonth = buildExpenseBlocks(
    entries,
    year,
    parentById,
    "month"
  );
  const expenses =
    groupBy === "coa"
      ? buildExpenseBlocks(entries, year, parentById, "coa")
      : expensesByMonth;
  const ytdSales = ytdTotalsFromBlocks(sales);
  const ytdExpenses = ytdTotalsFromBlocks(expensesByMonth);
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
      unassigned: sumPartnerAmounts(ytdSales.unassigned, ytdExpenses.unassigned),
    },
    ytdJessToMolly: flows.jessToMolly,
    ytdMollyToJess: flows.mollyToJess,
  };
}

export const TRUE_UP_EXCLUDE_SETUP_SQL = `ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS true_up_eligible BOOLEAN;

ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS true_up_payment_id UUID REFERENCES public.ledger(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_true_up_payment_id
  ON public.ledger (true_up_payment_id)
  WHERE true_up_payment_id IS NOT NULL;

ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS true_up_exclude_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE public.ledger
  DROP CONSTRAINT IF EXISTS ledger_true_up_exclude_reason_length;

ALTER TABLE public.ledger
  ADD CONSTRAINT ledger_true_up_exclude_reason_length
  CHECK (char_length(true_up_exclude_reason) <= 250);

NOTIFY pgrst, 'reload schema';`;

export function isTrueUpExcludeSchemaError(message: string) {
  const lower = message.toLowerCase();
  return (
    (lower.includes("true_up_eligible") ||
      lower.includes("true_up_payment_id") ||
      lower.includes("true_up_exclude_reason")) &&
    (lower.includes("column") || lower.includes("schema cache"))
  );
}
