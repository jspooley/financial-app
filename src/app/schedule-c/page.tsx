"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { fetchAllLedgerRows, normalizeLedgerRow } from "@/lib/ledger-db";
import {
  buildScheduleCReport,
  type ScheduleCSplit,
} from "@/lib/schedule-c";
import { createClient } from "@/lib/supabase/client";
import type { ChartOfAccount, LedgerEntry } from "@/lib/types";
import { formatCurrency, roundMoney } from "@/lib/utils";

function money(value: number) {
  return formatCurrency(value);
}

function signedClass(value: number) {
  if (value < 0) return "text-red-700";
  if (value > 0) return "text-emerald-700";
  return "text-slate-900";
}

function combineDesignerShare(split: ScheduleCSplit): ScheduleCSplit {
  return {
    ...split,
    jess: roundMoney(split.jess + split.perDesigner),
    molly: roundMoney(split.molly + split.perDesigner),
    perDesigner: 0,
  };
}

function signedAmount(value: number, negate?: boolean) {
  return negate ? -value : value;
}

function MoneyCells({
  jess,
  molly,
  tbd,
  business,
  emphasize,
}: {
  jess: number;
  molly: number;
  tbd: number;
  business: number;
  emphasize?: boolean;
}) {
  const weight = emphasize ? "font-bold" : "font-normal";
  return (
    <>
      <td className={`px-3 py-1.5 text-right tabular-nums ${weight} ${signedClass(jess)}`}>
        {money(jess)}
      </td>
      <td className={`px-3 py-1.5 text-right tabular-nums ${weight} ${signedClass(molly)}`}>
        {money(molly)}
      </td>
      <td className={`px-3 py-1.5 text-right tabular-nums ${weight} ${signedClass(tbd)}`}>
        {money(tbd)}
      </td>
      <td
        className={`px-3 py-1.5 text-right tabular-nums font-semibold ${signedClass(business)}`}
      >
        {money(business)}
      </td>
    </>
  );
}

function SplitCells({
  split,
  negate,
}: {
  split: ScheduleCSplit;
  negate?: boolean;
}) {
  const display = combineDesignerShare(split);
  return (
    <MoneyCells
      jess={signedAmount(display.jess, negate)}
      molly={signedAmount(display.molly, negate)}
      tbd={signedAmount(display.tbd, negate)}
      business={signedAmount(display.business, negate)}
    />
  );
}

function sharedHalfCells(split: ScheduleCSplit, negate?: boolean) {
  return (
    <MoneyCells
      jess={signedAmount(split.perDesigner, negate)}
      molly={signedAmount(split.perDesigner, negate)}
      tbd={0}
      business={signedAmount(split.sharedTotal, negate)}
    />
  );
}

function separateCells(split: ScheduleCSplit, negate?: boolean) {
  const business = roundMoney(split.jess + split.molly + split.tbd);
  return (
    <MoneyCells
      jess={signedAmount(split.jess, negate)}
      molly={signedAmount(split.molly, negate)}
      tbd={signedAmount(split.tbd, negate)}
      business={signedAmount(business, negate)}
    />
  );
}

function GroupHeaderRow({ label }: { label: string }) {
  return (
    <tr className="border-b border-slate-200 bg-slate-50">
      <td
        colSpan={5}
        className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600"
      >
        {label}
      </td>
    </tr>
  );
}

export default function ScheduleCPage() {
  const currentYear = String(new Date().getFullYear());
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccount[]>([]);
  const [year, setYear] = useState(currentYear);
  const [showBreakout, setShowBreakout] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const [{ data: ledgerData, error: ledgerError }, { data: coaData, error: coaError }] =
      await Promise.all([
        fetchAllLedgerRows(supabase, "*"),
        supabase
          .from("chart_of_accounts")
          .select("*")
          .order("category", { ascending: true }),
      ]);

    if (ledgerError || coaError) {
      setLoadError(ledgerError ?? coaError?.message ?? "Could not load report.");
      setEntries([]);
      setChartOfAccounts([]);
    } else {
      setEntries(ledgerData.map((row) => normalizeLedgerRow(row)));
      setChartOfAccounts(coaData ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const yearOptions = useMemo(() => {
    const years = new Set<string>([currentYear]);
    for (const entry of entries) {
      const entryYear = entry.entry_date?.slice(0, 4);
      if (/^\d{4}$/.test(entryYear)) years.add(entryYear);
    }
    return [...years].sort((a, b) => b.localeCompare(a));
  }, [currentYear, entries]);

  const report = useMemo(
    () => buildScheduleCReport(entries, chartOfAccounts, year),
    [chartOfAccounts, entries, year]
  );

  const jessTotalNet = roundMoney(
    report.netProfit.jess + report.netProfit.perDesigner
  );
  const mollyTotalNet = roundMoney(
    report.netProfit.molly + report.netProfit.perDesigner
  );

  return (
    <AppShell>
      <PageHeader
        title="Schedule C Report"
        description="Chart of accounts breakout for business income and expenses. Profit is retail price minus designer cost. Shipping, tax, receiving, delivery, and fees are passed through to the customer and are not part of profit. Sales Income, COGS, and most operating expenses split 50/50 unless a line is excluded from true-up. 203 commissions and fees stay with whoever paid them."
      />

      <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xs">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-900">Year</span>
              <select
                value={year}
                onChange={(event) => setYear(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {yearOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showBreakout}
              onChange={(event) => setShowBreakout(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500"
            />
            Show excluded vs 50/50 breakout
          </label>
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-slate-500">Loading Schedule C...</p>
      ) : loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {loadError}
        </div>
      ) : (
        <>
          <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Sales Income", report.grossReceipts.business],
              ["Cost of Goods Sold", -report.cogs.business],
              ["Other Expenses", -report.otherExpenses.business],
              ["Net Profit", report.netProfit.business],
            ].map(([label, amount]) => (
              <div
                key={String(label)}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="text-xs font-bold uppercase tracking-wide text-slate-700">
                  {label}
                </p>
                <p
                  className={`mt-1 text-xl font-semibold ${signedClass(Number(amount))}`}
                >
                  {money(Number(amount))}
                </p>
              </div>
            ))}
          </section>

          <section className="mb-5 overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">
              Jess and Molly
            </h2>
            <p className="mb-3 mt-1 text-sm text-slate-600">
              {showBreakout
                ? "Shared 50/50 is each designer’s half of amounts still in the true-up. Separate is lines excluded from true-up, plus 203 fees with the payer. Sales tax is excluded. Schedule C net is shared plus separate, added down each column."
                : "Jess and Molly include each person’s half of shared amounts plus any lines excluded from true-up. Check “Show excluded vs 50/50 breakout” to separate those."}
            </p>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
                  <th className="px-3 py-2 font-semibold"> </th>
                  <th className="px-3 py-2 text-right font-semibold">Jess</th>
                  <th className="px-3 py-2 text-right font-semibold">Molly</th>
                  <th className="px-3 py-2 text-right font-semibold">TBD</th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Business
                  </th>
                </tr>
              </thead>
              <tbody>
                {showBreakout ? (
                  <>
                    <GroupHeaderRow label="Shared 50/50" />
                    <tr className="border-b border-slate-100">
                      <td className="px-3 py-1.5 font-medium text-slate-900">
                        50% of Total Sales Income
                      </td>
                      {sharedHalfCells(report.grossReceipts)}
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="px-3 py-1.5 font-medium text-slate-900">
                        50% of Total COGS
                      </td>
                      {sharedHalfCells(report.cogs, true)}
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="px-3 py-1.5 font-medium text-slate-900">
                        50% of Total Other Expenses
                      </td>
                      {sharedHalfCells(report.otherExpenses, true)}
                    </tr>
                    <GroupHeaderRow label="Separate (excluded from true-up)" />
                    <tr className="border-b border-slate-100">
                      <td className="px-3 py-1.5 font-medium text-slate-900">
                        Sales Income
                      </td>
                      {separateCells(report.grossReceipts)}
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="px-3 py-1.5 font-medium text-slate-900">
                        COGS
                      </td>
                      {separateCells(report.cogs, true)}
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="px-3 py-1.5 font-medium text-slate-900">
                        Other Expenses
                      </td>
                      {separateCells(report.otherExpenses, true)}
                    </tr>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <td className="px-3 py-1.5 font-bold text-slate-900">
                        Schedule C net
                      </td>
                      <MoneyCells
                        jess={jessTotalNet}
                        molly={mollyTotalNet}
                        tbd={report.netProfit.tbd}
                        business={report.netProfit.business}
                        emphasize
                      />
                    </tr>
                  </>
                ) : (
                  <>
                    <tr className="border-b border-slate-100">
                      <td className="px-3 py-1.5 font-medium text-slate-900">
                        Sales Income
                      </td>
                      <SplitCells split={report.grossReceipts} />
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="px-3 py-1.5 font-medium text-slate-900">
                        Cost of Goods Sold
                      </td>
                      <SplitCells split={report.cogs} negate />
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="px-3 py-1.5 font-medium text-slate-900">
                        Other Expenses
                      </td>
                      <SplitCells split={report.otherExpenses} negate />
                    </tr>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <td className="px-3 py-1.5 font-bold text-slate-900">
                        Net Profit
                      </td>
                      <SplitCells split={report.netProfit} />
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-4 text-sm text-slate-600">
              Sales income on invoice lines is retail price plus shipping, receiving,
              delivery, and fees. Designer cost stays in COGS. Those pass-through
              charges and sales tax are not part of profit. Balance-sheet, equity
              (300-series), and liability (400-series) activity is left off this
              table. 50/50 share is each designer’s half of shared 100, 101, and
              other 200-series amounts. Jess and Molly are lines excluded from
              true-up, plus 203 fees with the payer. Jess total and Molly total
              are 50/50 share plus that designer’s separate amount.
            </p>
            <DataTable
              stickyHeader
              stickyFirstColumn
              maxBodyHeight="70vh"
              mobileTitleKey="category"
              columns={[
                { key: "category", label: "CoA Category" },
                { key: "perDesigner", label: "50/50 share" },
                { key: "jess", label: "Jess" },
                { key: "molly", label: "Molly" },
                { key: "tbd", label: "TBD" },
                { key: "jessTotal", label: "Jess total" },
                { key: "mollyTotal", label: "Molly total" },
              ]}
              rows={report.rows
                .filter((row) => row.treatment !== "Excluded from Schedule C")
                .map((row) => {
                  const jessTotal = roundMoney(row.jess + row.perDesigner);
                  const mollyTotal = roundMoney(row.molly + row.perDesigner);
                  return {
                    category: row.category,
                    perDesigner: money(row.perDesigner),
                    jess: money(row.jess),
                    molly: money(row.molly),
                    tbd: money(row.tbd),
                    jessTotal: money(jessTotal),
                    mollyTotal: money(mollyTotal),
                  };
                })}
              emptyMessage="No Schedule C categories found."
            />
          </section>
        </>
      )}
    </AppShell>
  );
}
