import { computePlTotals } from "./pl-report";
import type { CashflowDepartment, LedgerEntry } from "./types";

export type OverviewChartMonth = {
  label: string;
  sales: number;
  cost: number;
  expenses: number;
  profit: number;
};

export type OverviewChartSeries = {
  interior: OverviewChartMonth[];
  paint: OverviewChartMonth[];
  both: OverviewChartMonth[];
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function entryDepartment(entry: Pick<LedgerEntry, "department">): CashflowDepartment {
  if (entry.department === "Paint" || entry.department === "Internal") {
    return entry.department;
  }
  return "Interior Design";
}

function barsForDepartments(
  entries: LedgerEntry[],
  options: {
    year: number;
    throughMonth: number;
    invoicedPoKeys?: Set<string>;
    departments: Set<CashflowDepartment>;
  }
): OverviewChartMonth[] {
  const prefix = `${options.year}-`;
  const byMonth = new Map<number, LedgerEntry[]>();
  for (const entry of entries) {
    if (!options.departments.has(entryDepartment(entry))) continue;
    if (!entry.entry_date?.startsWith(prefix)) continue;
    const month = Number.parseInt(entry.entry_date.slice(5, 7), 10);
    if (month < 1 || month > options.throughMonth) continue;
    const list = byMonth.get(month) ?? [];
    list.push(entry);
    byMonth.set(month, list);
  }

  return Array.from({ length: options.throughMonth }, (_, index) => {
    const month = index + 1;
    const totals = computePlTotals(byMonth.get(month) ?? [], options.invoicedPoKeys);
    return {
      label: MONTH_LABELS[index],
      sales: totals.revenue,
      cost: totals.cogs,
      expenses: totals.expenseAmount,
      profit: totals.netProfit,
    };
  });
}

/** Appointment counts by month for the chart year, using appointment date. */
export function countAppointmentsByMonth(
  appointments: { appointment_date: string | null }[],
  year: number,
  throughMonth: number
): number[] {
  const counts = Array.from({ length: throughMonth }, () => 0);
  const prefix = `${year}-`;
  for (const appointment of appointments) {
    const date = appointment.appointment_date ?? "";
    if (!date.startsWith(prefix)) continue;
    const month = Number.parseInt(date.slice(5, 7), 10);
    if (month < 1 || month > throughMonth) continue;
    counts[month - 1] += 1;
  }
  return counts;
}

/** Monthly sales, cost, expenses, and profit for the overview chart. */
export function buildOverviewChartSeries(
  entries: LedgerEntry[],
  options: {
    year: number;
    throughMonth: number;
    invoicedPoKeys?: Set<string>;
  }
): OverviewChartSeries {
  const shared = {
    year: options.year,
    throughMonth: options.throughMonth,
    invoicedPoKeys: options.invoicedPoKeys,
  };
  return {
    interior: barsForDepartments(entries, {
      ...shared,
      departments: new Set(["Interior Design"]),
    }),
    paint: barsForDepartments(entries, {
      ...shared,
      departments: new Set(["Paint"]),
    }),
    both: barsForDepartments(entries, {
      ...shared,
      departments: new Set(["Interior Design", "Paint"]),
    }),
  };
}
