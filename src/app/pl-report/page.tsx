import { AppShell } from "@/components/AppShell";
import { BalanceSheetItems } from "@/components/pl-report/BalanceSheetItems";
import { type PlExpenseDetailRow } from "@/components/pl-report/PlTotalsCards";
import {
  PlYearSection,
  type SavedBusinessGoals,
} from "@/components/pl-report/PlYearSection";
import { SalesComparisonChart } from "@/components/overview/SalesComparisonChart";
import { buildOverviewChartSeries, countAppointmentsByMonth } from "@/lib/overview-chart";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  buildBalanceSheetReview,
  buildPlMonthlyRows,
  computePlTotals,
  filterLedgerEntriesForYear,
  filterPlExpenseEntries,
  sumPlExpenseAmount,
  type PlReportRow,
} from "@/lib/pl-report";
import { createClient } from "@/lib/supabase/server";
import { normalizeLedgerRow } from "@/lib/ledger-db";
import {
  isPaymentCompanionRow,
  mergePaymentCompanionsOntoEntries,
} from "@/lib/payment-companions";
import { formatCurrency, formatPercent, grossProfitGoalFromTradePartners, roundMoney } from "@/lib/utils";
import type { TradePartner } from "@/lib/types";
import {
  buildPersonalFundsReport,
  businessDebtCostFromReport,
} from "@/lib/personal-funds-report";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function signedAmountClass(value: number, emphasize?: boolean) {
  const weight = emphasize ? "font-semibold" : "";
  const color =
    value < 0 ? "text-red-700" : value > 0 ? "text-emerald-700" : "text-slate-800";
  return `${weight} ${color}`.trim();
}

function PlAmountCell({
  value,
  emphasize,
}: {
  value: number;
  emphasize?: boolean;
}) {
  return (
    <span className={signedAmountClass(value, emphasize)}>
      {formatCurrency(value)}
    </span>
  );
}

function PlMarginCell({ value, emphasize }: { value: number; emphasize?: boolean }) {
  return (
    <span className={signedAmountClass(value, emphasize)}>
      {formatPercent(value)}
    </span>
  );
}

function appointmentsForRow(row: PlReportRow, appointments: number[]) {
  if (row.kind === "month") return appointments[row.month - 1] ?? 0;
  const start = (row.quarter - 1) * 3;
  return appointments.slice(start, start + 3).reduce((sum, count) => sum + count, 0);
}

function yearToDateTotals(rows: PlReportRow[]) {
  const months = rows.filter((row) => row.kind === "month");
  const revenue = roundMoney(months.reduce((sum, row) => sum + row.totals.revenue, 0));
  const cogs = roundMoney(months.reduce((sum, row) => sum + row.totals.cogs, 0));
  const expenseAmount = roundMoney(
    months.reduce((sum, row) => sum + row.totals.expenseAmount, 0)
  );
  const grossProfit = roundMoney(revenue - cogs);
  const netProfit = roundMoney(months.reduce((sum, row) => sum + row.totals.netProfit, 0));
  return {
    revenue,
    cogs,
    expenseAmount,
    grossProfit,
    grossProfitMargin: revenue > 0 ? roundMoney((grossProfit / revenue) * 100) : 0,
    netProfit,
    netProfitMargin: revenue > 0 ? roundMoney((netProfit / revenue) * 100) : 0,
  };
}

function PlMonthlyTable({
  rows,
  appointments,
}: {
  rows: PlReportRow[];
  appointments: number[];
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
        No ledger activity for this year yet.
      </p>
    );
  }

  const columns = [
    { key: "period", label: "Period", className: "text-left" },
    { key: "appointments", label: "Appts", className: "text-left" },
    { key: "revenue", label: "Revenue", className: "text-right" },
    { key: "cogs", label: "COGS", className: "text-right" },
    { key: "expense", label: "Expenses", className: "text-right" },
    { key: "grossProfit", label: "Gross Profit", className: "text-right" },
    { key: "margin", label: "Gross Margin", className: "text-right" },
    { key: "netProfit", label: "Net Profit", className: "text-right" },
    { key: "netMargin", label: "Net Margin", className: "text-right" },
  ] as const;

  const ytd = yearToDateTotals(rows);
  const ytdAppointments = appointments.reduce((sum, count) => sum + count, 0);

  return (
    <>
      <div className="mt-4 space-y-3 md:hidden">
        {rows.map((row) => {
          const emphasize = row.kind === "quarter";
          const cardClass = emphasize
            ? "border-brand-200 bg-brand-50"
            : "border-slate-200 bg-white";
          return (
            <article
              key={row.kind === "quarter" ? `q${row.quarter}` : `m${row.month}`}
              className={`rounded-xl border p-4 shadow-sm ${cardClass}`}
            >
              <p
                className={`text-sm ${emphasize ? "font-semibold text-brand-900" : "font-medium text-slate-900"}`}
              >
                {row.label}
              </p>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Appts</dt>
                  <dd className={emphasize ? "font-semibold text-slate-900" : "text-slate-800"}>
                    {appointmentsForRow(row, appointments)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Revenue</dt>
                  <dd>
                    <PlAmountCell value={row.totals.revenue} emphasize={emphasize} />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">COGS</dt>
                  <dd>
                    <PlAmountCell value={-row.totals.cogs} emphasize={emphasize} />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Expenses</dt>
                  <dd>
                    <PlAmountCell
                      value={-row.totals.expenseAmount}
                      emphasize={emphasize}
                    />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Gross Profit</dt>
                  <dd>
                    <PlAmountCell value={row.totals.grossProfit} emphasize={emphasize} />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Gross Margin</dt>
                  <dd>
                    <PlMarginCell
                      value={row.totals.grossProfitMargin}
                      emphasize={emphasize}
                    />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Net Profit</dt>
                  <dd>
                    <PlAmountCell value={row.totals.netProfit} emphasize={emphasize} />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Net Margin</dt>
                  <dd>
                    <PlMarginCell
                      value={row.totals.netProfitMargin}
                      emphasize={emphasize}
                    />
                  </dd>
                </div>
              </dl>
            </article>
          );
        })}
        <article className="rounded-xl border border-brand-200 bg-brand-50 p-4 shadow-sm">
          <p className="text-sm font-semibold text-brand-900">Year to date</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Appts</dt>
              <dd className="font-semibold text-slate-900">{ytdAppointments}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Revenue</dt>
              <dd>
                <PlAmountCell value={ytd.revenue} emphasize />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">COGS</dt>
              <dd>
                <PlAmountCell value={-ytd.cogs} emphasize />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Expenses</dt>
              <dd>
                <PlAmountCell value={-ytd.expenseAmount} emphasize />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Gross Profit</dt>
              <dd>
                <PlAmountCell value={ytd.grossProfit} emphasize />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Gross Margin</dt>
              <dd>
                <PlMarginCell value={ytd.grossProfitMargin} emphasize />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Net Profit</dt>
              <dd>
                <PlAmountCell value={ytd.netProfit} emphasize />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Net Margin</dt>
              <dd>
                <PlMarginCell value={ytd.netProfitMargin} emphasize />
              </dd>
            </div>
          </dl>
        </article>
      </div>

      <div className="mt-4 hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-4 py-3 font-medium text-slate-600 ${column.className}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const emphasize = row.kind === "quarter";
              const rowClass = emphasize ? "bg-brand-50/80" : "hover:bg-slate-50/80";
              const rowKey =
                row.kind === "quarter" ? `q${row.quarter}` : `m${row.month}`;
              return (
                <tr key={rowKey} className={rowClass}>
                  <td
                    className={`px-4 py-3 text-left ${emphasize ? "font-semibold text-brand-900" : "text-slate-900"}`}
                  >
                    {row.label}
                  </td>
                  <td
                    className={`px-4 py-3 text-left ${emphasize ? "font-semibold text-slate-900" : "text-slate-800"}`}
                  >
                    {appointmentsForRow(row, appointments)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PlAmountCell value={row.totals.revenue} emphasize={emphasize} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PlAmountCell value={-row.totals.cogs} emphasize={emphasize} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PlAmountCell
                      value={-row.totals.expenseAmount}
                      emphasize={emphasize}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PlAmountCell value={row.totals.grossProfit} emphasize={emphasize} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PlMarginCell
                      value={row.totals.grossProfitMargin}
                      emphasize={emphasize}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PlAmountCell value={row.totals.netProfit} emphasize={emphasize} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PlMarginCell
                      value={row.totals.netProfitMargin}
                      emphasize={emphasize}
                    />
                  </td>
                </tr>
              );
            })}
            <tr className="bg-brand-50/80">
              <td className="px-4 py-3 text-left font-semibold text-brand-900">Year to date</td>
              <td className="px-4 py-3 text-left font-semibold text-slate-900">
                {ytdAppointments}
              </td>
              <td className="px-4 py-3 text-right">
                <PlAmountCell value={ytd.revenue} emphasize />
              </td>
              <td className="px-4 py-3 text-right">
                <PlAmountCell value={-ytd.cogs} emphasize />
              </td>
              <td className="px-4 py-3 text-right">
                <PlAmountCell value={-ytd.expenseAmount} emphasize />
              </td>
              <td className="px-4 py-3 text-right">
                <PlAmountCell value={ytd.grossProfit} emphasize />
              </td>
              <td className="px-4 py-3 text-right">
                <PlMarginCell value={ytd.grossProfitMargin} emphasize />
              </td>
              <td className="px-4 py-3 text-right">
                <PlAmountCell value={ytd.netProfit} emphasize />
              </td>
              <td className="px-4 py-3 text-right">
                <PlMarginCell value={ytd.netProfitMargin} emphasize />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function toGoalNumber(value: unknown) {
  if (value == null || value === "") return null;
  const goal = Number(value);
  return Number.isFinite(goal) ? goal : null;
}

export default async function PlReportPage() {
  const supabase = await createClient();
  const reportYear = new Date().getFullYear();
  const throughMonth = new Date().getMonth() + 1;

  const [
    { data: ledgerTotals },
    { data: invoiceHeaders },
    { data: tradePartners },
    { data: appointmentDates },
    { data: goalRow, error: goalsError },
  ] = await Promise.all([
    supabase.from("ledger").select("*, clients(name)"),
    supabase.from("invoicing").select("client_id, po_number"),
    supabase.from("trade_partners").select("retail_price, designer_cost, discount_amount"),
    supabase.from("appointments").select("appointment_date"),
    supabase
      .from("business_goals")
      .select("gross_profit_margin, gross_profit, net_profit, net_profit_margin")
      .eq("id", "default")
      .maybeSingle(),
  ]);

  const invoicedPoKeys = new Set(
    (invoiceHeaders ?? []).map(
      (invoice) =>
        `${invoice.client_id}:${(invoice.po_number ?? "").trim().toLowerCase()}`
    )
  );

  const allLedgerEntries = ((ledgerTotals ?? []) as Array<Record<string, unknown>>).map(
    (row) => normalizeLedgerRow(row)
  );
  const paymentCompanions = allLedgerEntries.filter(isPaymentCompanionRow);
  // Overlay companion payment fields so accepted-variance math sees real cash applied.
  const ledgerForPl = mergePaymentCompanionsOntoEntries(
    allLedgerEntries,
    paymentCompanions
  );

  const ytdEntries = filterLedgerEntriesForYear(ledgerForPl, reportYear);
  const businessDebtReport = buildPersonalFundsReport(allLedgerEntries);
  const ytdTotals = computePlTotals(
    ytdEntries,
    invoicedPoKeys,
    businessDebtCostFromReport(businessDebtReport)
  );
  const expenseEntries = filterPlExpenseEntries(ytdEntries).sort((a, b) =>
    b.entry_date.localeCompare(a.entry_date)
  );
  const expenseRows: PlExpenseDetailRow[] = expenseEntries.map((entry) => ({
    id: entry.id,
    entry_date: entry.entry_date,
    clientName: entry.clients?.name ?? "—",
    description: entry.description ?? "",
    po_number: entry.po_number,
    expense_amount: Number(entry.expense_amount ?? 0),
    shipping_receiving_amount: Number(entry.shipping_receiving_amount ?? 0),
    payment_fee: Number(entry.payment_fee ?? 0),
    tax_amount: Number(entry.tax_amount ?? 0),
    expenseTotal: sumPlExpenseAmount(entry),
  }));
  const monthlyRows = buildPlMonthlyRows(ledgerForPl, {
    year: reportYear,
    throughMonth,
    invoicedPoKeys,
  });
  const partners = (tradePartners ?? []) as TradePartner[];
  const grossProfitGoal = grossProfitGoalFromTradePartners(partners);
  const savedGoals: SavedBusinessGoals = {
    grossProfitMargin: toGoalNumber(goalRow?.gross_profit_margin),
    grossProfit: toGoalNumber(goalRow?.gross_profit),
    netProfit: toGoalNumber(goalRow?.net_profit),
    netProfitMargin: toGoalNumber(goalRow?.net_profit_margin),
  };
  const appointmentCounts = countAppointmentsByMonth(
    appointmentDates ?? [],
    reportYear,
    throughMonth
  );
  const chartSeries = buildOverviewChartSeries(ledgerForPl, {
    year: reportYear,
    throughMonth,
    invoicedPoKeys,
  });
  const balanceSheetReview = buildBalanceSheetReview(allLedgerEntries);

  return (
    <AppShell>
      <PageHeader
        title="P&L Report"
        description="Revenue, cost of goods sold, expenses, gross profit, and net profit from ledger activity."
      />

      <PlYearSection
        reportYear={reportYear}
        totals={ytdTotals}
        expenseRows={expenseRows}
        initialGoal={grossProfitGoal}
        savedGoals={savedGoals}
        goalsReady={!goalsError}
        overviewChart={
          <SalesComparisonChart
            year={reportYear}
            series={chartSeries}
            appointments={appointmentCounts}
            details={
              <div className="mt-6 border-t border-slate-200 pt-4">
                <h3 className="text-base font-semibold text-slate-900">Monthly Breakdown</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Ledger activity by <strong>entry date</strong> for {reportYear}. Quarterly
                  subtotals appear after March, June, September, and December.
                </p>
                <PlMonthlyTable rows={monthlyRows} appointments={appointmentCounts} />
              </div>
            }
          />
        }
      />

      <BalanceSheetItems items={balanceSheetReview.items} />

    </AppShell>
  );
}
