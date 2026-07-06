import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  buildPlMonthlyRows,
  computePlTotals,
  filterLedgerEntriesForYear,
  type PlReportRow,
  type PlTotals,
} from "@/lib/pl-report";
import { createClient } from "@/lib/supabase/server";
import { normalizeLedgerRow } from "@/lib/ledger-db";
import { formatCurrency, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function PlTotalsCards({
  totals,
  expenseCount,
}: {
  totals: PlTotals;
  expenseCount: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5 sm:gap-4">
      <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">Revenue</p>
        <p className="mt-1 text-xl font-semibold text-brand-800">
          {formatCurrency(totals.revenue)}
        </p>
      </div>
      <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">Cost of Goods Sold</p>
        <p className="mt-1 text-xl font-semibold text-slate-900">
          {formatCurrency(totals.cogs)}
        </p>
      </div>
      <Link
        href="/payments"
        className="rounded-lg border border-slate-100 bg-slate-50 p-4 transition hover:border-brand-200"
      >
        <p className="text-xs uppercase tracking-wide text-slate-500">Expense Amount</p>
        <p className="mt-1 text-xl font-semibold text-slate-900">
          {formatCurrency(totals.expenseAmount)}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {expenseCount === 0
            ? "No expenses recorded"
            : `Total across ${expenseCount} ledger ${expenseCount === 1 ? "entry" : "entries"}`}
        </p>
      </Link>
      <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
        <p className="text-sm font-semibold leading-snug text-slate-700">
          GROSS PROFIT
          <br />
          <span className="text-xs font-medium text-slate-500">
            (before expenses &amp; loans)
          </span>
        </p>
        <p className="mt-2 text-2xl font-bold text-brand-800">
          {formatCurrency(totals.grossProfit)}
        </p>
      </div>
      <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
        <p className="text-sm font-semibold leading-snug text-slate-700">
          GROSS PROFIT MARGIN
        </p>
        <p className="mt-2 text-2xl font-bold text-brand-800">
          {formatPercent(totals.grossProfitMargin)}
        </p>
        <p className="mt-1 text-xs text-slate-500">Profit after direct costs</p>
      </div>
    </div>
  );
}

function PlAmountCell({ value, emphasize }: { value: number; emphasize?: boolean }) {
  return (
    <span className={emphasize ? "font-semibold text-slate-900" : "text-slate-800"}>
      {formatCurrency(value)}
    </span>
  );
}

function PlMarginCell({ value, emphasize }: { value: number; emphasize?: boolean }) {
  return (
    <span className={emphasize ? "font-semibold text-brand-800" : "text-brand-700"}>
      {formatPercent(value)}
    </span>
  );
}

function PlMonthlyTable({ rows }: { rows: PlReportRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
        No ledger activity for this year yet.
      </p>
    );
  }

  const columns = [
    { key: "period", label: "Period", className: "text-left" },
    { key: "revenue", label: "Revenue", className: "text-right" },
    { key: "cogs", label: "COGS", className: "text-right" },
    { key: "expense", label: "Expenses", className: "text-right" },
    { key: "grossProfit", label: "Gross Profit", className: "text-right" },
    { key: "margin", label: "Margin", className: "text-right" },
  ] as const;

  return (
    <>
      <div className="mt-6 space-y-3 md:hidden">
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
                  <dt className="text-slate-500">Revenue</dt>
                  <dd>
                    <PlAmountCell value={row.totals.revenue} emphasize={emphasize} />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">COGS</dt>
                  <dd>
                    <PlAmountCell value={row.totals.cogs} emphasize={emphasize} />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Expenses</dt>
                  <dd>
                    <PlAmountCell
                      value={row.totals.expenseAmount}
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
                  <dt className="text-slate-500">Margin</dt>
                  <dd>
                    <PlMarginCell
                      value={row.totals.grossProfitMargin}
                      emphasize={emphasize}
                    />
                  </dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>

      <div className="mt-6 hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
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
                  <td className="px-4 py-3 text-right">
                    <PlAmountCell value={row.totals.revenue} emphasize={emphasize} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PlAmountCell value={row.totals.cogs} emphasize={emphasize} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PlAmountCell
                      value={row.totals.expenseAmount}
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default async function PlReportPage() {
  const supabase = await createClient();
  const reportYear = new Date().getFullYear();
  const throughMonth = new Date().getMonth() + 1;

  const [{ data: ledgerTotals }, { data: invoiceHeaders }] = await Promise.all([
    supabase.from("ledger").select("*, clients(name)"),
    supabase.from("invoicing").select("client_id, po_number"),
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

  const ytdEntries = filterLedgerEntriesForYear(allLedgerEntries, reportYear);
  const ytdTotals = computePlTotals(ytdEntries, invoicedPoKeys);
  const expenseCount = ytdEntries.filter(
    (entry) => Number(entry.expense_amount ?? 0) > 0
  ).length;
  const monthlyRows = buildPlMonthlyRows(allLedgerEntries, {
    year: reportYear,
    throughMonth,
    invoicedPoKeys,
  });

  return (
    <AppShell>
      <PageHeader
        title="P&L Report"
        description="Revenue, cost of goods sold, expenses, and gross profit from ledger activity."
      />

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">
          Year to Date — {reportYear}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          For each invoiced line: <strong>Revenue</strong> = payments received,{" "}
          <strong>Cost of goods sold</strong> = total designer cost.{" "}
          <strong>Gross profit</strong> = revenue − cost (before expenses &amp; loans).
          Uninvoiced debit costs are included in cost of goods sold only.
        </p>
        <div className="mt-4">
          <PlTotalsCards totals={ytdTotals} expenseCount={expenseCount} />
        </div>
        <p className="mt-4 text-sm">
          <Link
            href="/reconciliation"
            className="font-medium text-brand-700 hover:text-brand-800 hover:underline"
          >
            View reconciliation report →
          </Link>
          <span className="text-slate-500">
            {" "}
            — compare Invoice History, Payments, and Revenue totals
          </span>
        </p>
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">Monthly Breakdown</h2>
        <p className="mt-1 text-sm text-slate-600">
          Ledger activity by <strong>entry date</strong> for {reportYear}. Quarterly
          subtotals appear after March, June, September, and December.
        </p>
        <PlMonthlyTable rows={monthlyRows} />
      </section>
    </AppShell>
  );
}
