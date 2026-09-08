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

function moneyOrDash(value: number, hidden?: boolean) {
  if (hidden) return "—";
  return money(value);
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

function SplitCells({
  split,
  negate,
  showBreakout,
}: {
  split: ScheduleCSplit;
  negate?: boolean;
  showBreakout: boolean;
}) {
  const display = showBreakout ? split : combineDesignerShare(split);
  const jess = negate ? -display.jess : display.jess;
  const molly = negate ? -display.molly : display.molly;
  const perDesigner = negate ? -split.perDesigner : split.perDesigner;
  const tbd = negate ? -display.tbd : display.tbd;
  const business = negate ? -display.business : display.business;
  return (
    <>
      <td className={`px-3 py-1.5 text-right tabular-nums ${signedClass(jess)}`}>
        {money(jess)}
      </td>
      <td className={`px-3 py-1.5 text-right tabular-nums ${signedClass(molly)}`}>
        {money(molly)}
      </td>
      {showBreakout ? (
        <td
          className={`px-3 py-1.5 text-right tabular-nums ${signedClass(perDesigner)}`}
        >
          {money(perDesigner)}
        </td>
      ) : null}
      <td className={`px-3 py-1.5 text-right tabular-nums ${signedClass(tbd)}`}>
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
        description="Chart of accounts breakout for business income and expenses. Sales, COGS, and most operating expenses split 50/50 unless a line is excluded from true-up. 203 commissions and fees and 214 taxes stay with whoever paid them."
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
              ["Gross Receipts", report.grossReceipts.business],
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
              {showBreakout ? "Jess, Molly, and Per Designer" : "Jess and Molly"}
            </h2>
            <p className="mb-3 mt-1 text-sm text-slate-600">
              {showBreakout
                ? "Jess and Molly are lines excluded from true-up. Per Designer is each person’s half of everything still shared. Each designer’s Schedule C net is their column plus Per Designer."
                : "Jess and Molly include each person’s half of shared amounts plus any lines excluded from true-up. Check “Show excluded vs 50/50 breakout” to separate those."}
            </p>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
                  <th className="px-3 py-2 font-semibold"> </th>
                  <th className="px-3 py-2 text-right font-semibold">Jess</th>
                  <th className="px-3 py-2 text-right font-semibold">Molly</th>
                  {showBreakout ? (
                    <th className="px-3 py-2 text-right font-semibold">
                      Per Designer
                    </th>
                  ) : null}
                  <th className="px-3 py-2 text-right font-semibold">TBD</th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Business
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-100">
                  <td className="px-3 py-1.5 font-medium text-slate-900">
                    Gross Receipts
                  </td>
                  <SplitCells
                    split={report.grossReceipts}
                    showBreakout={showBreakout}
                  />
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="px-3 py-1.5 font-medium text-slate-900">
                    Cost of Goods Sold
                  </td>
                  <SplitCells
                    split={report.cogs}
                    negate
                    showBreakout={showBreakout}
                  />
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="px-3 py-1.5 font-medium text-slate-900">
                    Other Expenses
                  </td>
                  <SplitCells
                    split={report.otherExpenses}
                    negate
                    showBreakout={showBreakout}
                  />
                </tr>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <td className="px-3 py-1.5 font-bold text-slate-900">
                    Net Profit
                  </td>
                  <SplitCells
                    split={report.netProfit}
                    showBreakout={showBreakout}
                  />
                </tr>
                {showBreakout ? (
                  <tr className="border-b border-slate-100">
                    <td className="px-3 py-1.5 font-bold text-slate-900">
                      Schedule C net (column + Per Designer)
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right tabular-nums font-bold ${signedClass(jessTotalNet)}`}
                    >
                      {money(jessTotalNet)}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right tabular-nums font-bold ${signedClass(mollyTotalNet)}`}
                    >
                      {money(mollyTotalNet)}
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-400">—</td>
                    <td
                      className={`px-3 py-1.5 text-right tabular-nums font-bold ${signedClass(report.netProfit.tbd)}`}
                    >
                      {money(report.netProfit.tbd)}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right tabular-nums font-bold ${signedClass(report.netProfit.business)}`}
                    >
                      {money(report.netProfit.business)}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-4 text-sm text-slate-600">
              Uses posted debit and credit amounts by entry date. Balance-sheet,
              equity (300-series), and liability (400-series) activity is shown for
              review but excluded from Schedule C net profit.
              {showBreakout
                ? " Jess and Molly are excluded-from-true-up lines, plus 203 fees and 214 taxes with the payer. Per Designer is half of shared 100, 101, and other 200-series amounts."
                : " Jess and Molly include each person’s 50/50 share, plus excluded lines, 203 fees, and 214 taxes with the payer."}
            </p>
            <DataTable
              stickyHeader
              stickyFirstColumn
              mobileTitleKey="category"
              columns={[
                { key: "category", label: "CoA Category" },
                { key: "treatment", label: "Schedule C Treatment" },
                { key: "lines", label: "Lines" },
                { key: "debits", label: "Debits" },
                { key: "credits", label: "Credits" },
                { key: "jess", label: "Jess" },
                { key: "molly", label: "Molly" },
                ...(showBreakout
                  ? [{ key: "perDesigner", label: "Per Designer" }]
                  : []),
                { key: "tbd", label: "TBD" },
              ]}
              rows={report.rows.map((row) => {
                const excluded = row.treatment === "Excluded from Schedule C";
                const jess = showBreakout
                  ? row.jess
                  : roundMoney(row.jess + row.perDesigner);
                const molly = showBreakout
                  ? row.molly
                  : roundMoney(row.molly + row.perDesigner);
                return {
                  category: row.category,
                  treatment: row.treatment,
                  lines: row.lineCount,
                  debits: money(row.debits),
                  credits: money(row.credits),
                  jess: moneyOrDash(jess, excluded),
                  molly: moneyOrDash(molly, excluded),
                  ...(showBreakout
                    ? { perDesigner: moneyOrDash(row.perDesigner, excluded) }
                    : {}),
                  tbd: moneyOrDash(row.tbd, excluded),
                };
              })}
              emptyMessage="No chart of accounts categories found."
            />
          </section>
        </>
      )}
    </AppShell>
  );
}
