import type { LedgerEntry } from "./types";
import { roundMoney, sumLedgerCreditsAndDebits } from "./utils";

type LedgerPlEntry = Pick<
  LedgerEntry,
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
  | "tax_amount"
  | "shipping_receiving_amount"
  | "wholesale_retail"
  | "payment_fee"
>;

export type PlTotals = {
  revenue: number;
  cogs: number;
  expenseAmount: number;
  grossProfit: number;
  grossProfitMargin: number;
};

export type PlReportRow =
  | { kind: "month"; month: number; label: string; totals: PlTotals }
  | { kind: "quarter"; quarter: number; label: string; totals: PlTotals };

const QUARTER_END_MONTHS = [3, 6, 9, 12] as const;

export function computePlTotals(
  entries: LedgerPlEntry[],
  invoicedPoKeys?: Set<string>
): PlTotals {
  const balances = sumLedgerCreditsAndDebits(entries, { invoicedPoKeys });
  const revenue = roundMoney(balances.credits);
  const cogs = roundMoney(balances.debits);
  const grossProfit = roundMoney(revenue - cogs);
  const expenseAmount = roundMoney(
    entries.reduce((sum, entry) => sum + Number(entry.expense_amount ?? 0), 0)
  );
  const grossProfitMargin =
    revenue > 0 ? roundMoney((grossProfit / revenue) * 100) : 0;
  return { revenue, cogs, expenseAmount, grossProfit, grossProfitMargin };
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
