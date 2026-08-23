import type { LedgerEntry } from "./types";
import { getLedgerVarianceBeforeAcceptance } from "./invoice-utils";
import { isCostCompanionRow } from "./cost-companions";
import {
  cashflowClassificationFlags,
  isInvoiceGoodsLine,
  isOperatingExpenseCoa,
  isOperatingExpenseEntry,
} from "./coa";
import {
  isLedgerLineInvoicedForRevenue,
  ledgerLineCogs,
  ledgerLineRevenue,
  roundMoney,
  sumLedgerCreditsAndDebits,
} from "./utils";

type LedgerPlEntry = Pick<
  LedgerEntry,
  | "id"
  | "entry_date"
  | "client_id"
  | "po_number"
  | "designer_cost"
  | "retail_price"
  | "quantity"
  | "credit_debit"
  | "invoiced"
  | "invoice_id"
  | "payment_amount"
  | "expense_amount"
  | "discount_percent"
  | "customer_price"
  | "tax_amount"
  | "shipping_receiving_amount"
  | "wholesale_retail"
  | "payment_fee"
  | "variance_accepted"
  | "variance_amount"
  | "variance_notes"
  | "description"
  | "balance_sheet"
  | "companion_kind"
  | "debit_amount"
  | "credit_amount"
  | "coa_category"
  | "expense_type"
  | "source_ledger_id"
> & {
  clients?: { name: string } | null;
};

export type PlTotals = {
  revenue: number;
  cogs: number;
  expenseAmount: number;
  varianceAmount: number;
  shortfallAmount: number;
  grossProfit: number;
  grossProfitMargin: number;
  netProfit: number;
  netProfitMargin: number;
  /** Signed outstanding business debt (negative when the business owes). */
  businessDebt: number;
};

export type PlReportRow =
  | { kind: "month"; month: number; label: string; totals: PlTotals }
  | { kind: "quarter"; quarter: number; label: string; totals: PlTotals };

const QUARTER_END_MONTHS = [3, 6, 9, 12] as const;

/** Balance-sheet (e.g. personal use) lines are excluded from P&L profit math. */
export function isPlBalanceSheetEntry(
  entry: Pick<LedgerPlEntry, "balance_sheet">
): boolean {
  return Boolean(entry.balance_sheet);
}

export type BalanceSheetReviewKind =
  | "Personal-use goods"
  | "Personal-use companion"
  | "300-series transfer / equity"
  | "Unexpected";

export type BalanceSheetReviewItem = {
  entry: LedgerEntry;
  kind: BalanceSheetReviewKind;
};

export function balanceSheetReviewKind(
  entry: LedgerEntry,
  parentById: Map<string, LedgerEntry>
): BalanceSheetReviewKind {
  if (isInvoiceGoodsLine(entry)) return "Personal-use goods";
  if (entry.source_ledger_id) {
    const parent = parentById.get(entry.source_ledger_id);
    if (parent && (isInvoiceGoodsLine(parent) || parent.balance_sheet)) {
      return "Personal-use companion";
    }
  }
  if (cashflowClassificationFlags(entry.coa_category ?? "").balance_sheet) {
    return "300-series transfer / equity";
  }
  return "Unexpected";
}

export function buildBalanceSheetReview(entries: LedgerEntry[]) {
  const parentById = new Map(entries.map((entry) => [entry.id, entry]));
  const items = entries
    .filter((entry) => Boolean(entry.balance_sheet))
    .map((entry) => ({
      entry,
      kind: balanceSheetReviewKind(entry, parentById),
    }))
    .sort((a, b) => {
      const unexpectedDelta =
        Number(b.kind === "Unexpected") - Number(a.kind === "Unexpected");
      if (unexpectedDelta !== 0) return unexpectedDelta;
      const byDate = b.entry.entry_date.localeCompare(a.entry.entry_date);
      if (byDate !== 0) return byDate;
      return (a.entry.description ?? "").localeCompare(
        b.entry.description ?? "",
        undefined,
        { sensitivity: "base" }
      );
    });
  return {
    items,
    unexpected: items.filter((item) => item.kind === "Unexpected"),
  };
}

function entriesForPlTotals(entries: LedgerPlEntry[]): LedgerPlEntry[] {
  return entries.filter((entry) => !isPlBalanceSheetEntry(entry));
}

/**
 * S&U tax collected in cash on a wholesale line. Only when payment was received —
 * unpaid invoices do not create tax "revenue" to strip.
 */
export function salesUseTaxCollected(
  entry: LedgerPlEntry,
  invoicedPoKeys?: Set<string>
): number {
  if (isPlBalanceSheetEntry(entry)) return 0;
  if ((entry.wholesale_retail ?? "retail") !== "wholesale") return 0;
  if (!isLedgerLineInvoicedForRevenue(entry, invoicedPoKeys)) return 0;
  if (roundMoney(Number(entry.payment_amount ?? 0)) < 0.005) return 0;
  return roundMoney(Number(entry.tax_amount ?? 0));
}

/** Ledger lines that contribute expense amount to P&L (excludes balance sheet). */
export function filterPlExpenseEntries<T extends LedgerPlEntry>(entries: T[]): T[] {
  return entries.filter(
    (entry) => !isPlBalanceSheetEntry(entry) && sumPlExpenseAmount(entry) > 0
  );
}

/** Ledger lines with accepted underpayment variance in P&L (excludes balance sheet). */
export function filterPlVarianceEntries<T extends LedgerPlEntry>(entries: T[]): T[] {
  return entries.filter(
    (entry) => !isPlBalanceSheetEntry(entry) && sumPlAcceptedVariance(entry) > 0
  );
}

/**
 * Expenses come from three places:
 *  - cost companion rows (shipping / payment fees → 203), which carry the
 *    amount in debit_amount;
 *  - operating rows entered on Cashflow with a 200-series CoA (including the
 *    monthly S&U tax remittance under 214), net of any credit/refund;
 *  - the write-off expense amount on an invoice line.
 * The parent's shipping_receiving_amount / payment_fee are never added here —
 * those dollars already live on the companions (migration 061).
 */
export function sumPlExpenseAmount(entry: LedgerPlEntry): number {
  if (isCostCompanionRow(entry)) {
    return roundMoney(Number(entry.debit_amount ?? 0));
  }
  if (
    isOperatingExpenseEntry(entry) &&
    isOperatingExpenseCoa(entry.coa_category)
  ) {
    return roundMoney(
      Number(entry.debit_amount ?? 0) - Number(entry.credit_amount ?? 0)
    );
  }
  return roundMoney(Number(entry.expense_amount ?? 0));
}

/** Accepted underpayment variance (magnitude) that reduces net profit. */
export function sumPlAcceptedVariance(entry: LedgerPlEntry): number {
  if (!entry.variance_accepted) return 0;
  // Prefer the signed amount recorded at acceptance. Live recompute needs the
  // parent's payment fields; after companions those live on a separate row and
  // a bare parent looks fully unpaid.
  const stored = Number(entry.variance_amount ?? 0);
  if (stored !== 0) {
    return stored < 0 ? roundMoney(-stored) : 0;
  }
  const live = getLedgerVarianceBeforeAcceptance({
    retail_price: entry.retail_price,
    quantity: entry.quantity,
    discount_percent: entry.discount_percent,
    tax_amount: entry.tax_amount,
    shipping_receiving_amount: entry.shipping_receiving_amount,
    wholesale_retail: entry.wholesale_retail,
    designer_cost: entry.designer_cost,
    payment_fee: entry.payment_fee,
    payment_amount: entry.payment_amount,
  });
  return live < 0 ? roundMoney(-live) : 0;
}

/** @deprecated Use sumPlAcceptedVariance */
export function sumPlAcceptedShortfall(entry: LedgerPlEntry): number {
  return sumPlAcceptedVariance(entry);
}

/** Gross profit for one ledger line: revenue − COGS (same formula as P&L totals). */
export function ledgerLineGrossProfit(
  entry: LedgerPlEntry,
  invoicedPoKeys?: Set<string>
): number {
  if (isPlBalanceSheetEntry(entry)) return 0;
  return roundMoney(
    plLineRevenue(entry, invoicedPoKeys) - ledgerLineCogs(entry, invoicedPoKeys)
  );
}

/** Net profit: cash revenue − (COGS + expenses). */
export function ledgerLineNetProfit(
  entry: LedgerPlEntry,
  invoicedPoKeys?: Set<string>
): number {
  if (isPlBalanceSheetEntry(entry)) return 0;
  return roundMoney(
    plLineRevenue(entry, invoicedPoKeys) -
      (ledgerLineCogs(entry, invoicedPoKeys) + sumPlExpenseAmount(entry))
  );
}

/** Line revenue net of S&U tax collected for the state. */
export function plLineRevenue(
  entry: LedgerPlEntry,
  invoicedPoKeys?: Set<string>
): number {
  return roundMoney(
    ledgerLineRevenue(entry, invoicedPoKeys) -
      salesUseTaxCollected(entry, invoicedPoKeys)
  );
}

function sumPlExpenses(entries: LedgerPlEntry[]): number {
  return roundMoney(
    entries.reduce((sum, entry) => sum + sumPlExpenseAmount(entry), 0)
  );
}

export function computePlTotals(
  entries: LedgerPlEntry[],
  invoicedPoKeys?: Set<string>,
  businessDebtCost = 0
): PlTotals {
  const plEntries = entriesForPlTotals(entries);
  const balances = sumLedgerCreditsAndDebits(plEntries, { invoicedPoKeys });
  // Tax billed to clients is owed to the state, not earned — see salesUseTaxCollected.
  const salesTaxCollected = roundMoney(
    plEntries.reduce(
      (sum, entry) => sum + salesUseTaxCollected(entry, invoicedPoKeys),
      0
    )
  );
  const revenue = roundMoney(balances.credits - salesTaxCollected);
  const cogs = roundMoney(balances.debits);
  const grossProfit = roundMoney(revenue - cogs);
  const expenseAmount = sumPlExpenses(plEntries);
  // Cash-basis revenue: uncollected invoice write-offs are not booked as revenue,
  // so accepted underpayment variance is not subtracted again here.
  const varianceAmount = 0;
  const debtCost = roundMoney(businessDebtCost);
  const netProfit = roundMoney(revenue - (cogs + expenseAmount + debtCost));
  const grossProfitMargin =
    revenue > 0 ? roundMoney((grossProfit / revenue) * 100) : 0;
  const netProfitMargin =
    revenue > 0 ? roundMoney((netProfit / revenue) * 100) : 0;
  return {
    revenue,
    cogs,
    expenseAmount,
    varianceAmount,
    shortfallAmount: varianceAmount,
    grossProfit,
    grossProfitMargin,
    netProfit,
    netProfitMargin,
    businessDebt: roundMoney(-debtCost),
  };
}

export function filterLedgerEntriesForYear(
  entries: LedgerPlEntry[],
  year: number
): LedgerPlEntry[] {
  const prefix = `${year}-`;
  return entries.filter(
    (entry) =>
      typeof entry.entry_date === "string" && entry.entry_date.startsWith(prefix)
  );
}

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
  }).format(new Date(year, month - 1, 1));
}

/** Monthly P&L rows for Jan–throughMonth with Q1–Q4 subtotals after Mar, Jun, Sep, and Dec. */
export function buildPlMonthlyRows(
  entries: LedgerPlEntry[],
  options: {
    year: number;
    throughMonth: number;
    invoicedPoKeys?: Set<string>;
  }
): PlReportRow[] {
  const { year, throughMonth, invoicedPoKeys } = options;
  const byMonth = new Map<number, LedgerPlEntry[]>();

  for (const entry of filterLedgerEntriesForYear(entries, year)) {
    const month = parseInt(entry.entry_date!.slice(5, 7), 10);
    if (month < 1 || month > 12) continue;
    const list = byMonth.get(month) ?? [];
    list.push(entry);
    byMonth.set(month, list);
  }

  const rows: PlReportRow[] = [];
  let quarterEntries: LedgerPlEntry[] = [];
  let quarterIndex = 0;

  for (let month = 1; month <= throughMonth; month++) {
    const monthEntries = byMonth.get(month) ?? [];
    rows.push({
      kind: "month",
      month,
      label: monthLabel(year, month),
      totals: computePlTotals(monthEntries, invoicedPoKeys),
    });

    quarterEntries = quarterEntries.concat(monthEntries);

    if (
      quarterIndex < QUARTER_END_MONTHS.length &&
      month === QUARTER_END_MONTHS[quarterIndex]
    ) {
      rows.push({
        kind: "quarter",
        quarter: quarterIndex + 1,
        label: `Q${quarterIndex + 1} ${year}`,
        totals: computePlTotals(quarterEntries, invoicedPoKeys),
      });
      quarterEntries = [];
      quarterIndex += 1;
    }
  }

  return rows;
}
