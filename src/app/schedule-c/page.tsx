"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { coaAccountNumber } from "@/lib/coa";
import { normalizeLedgerRow } from "@/lib/ledger-db";
import { createClient } from "@/lib/supabase/client";
import type { ChartOfAccount, LedgerEntry } from "@/lib/types";
import { formatCurrency, roundMoney } from "@/lib/utils";

type ScheduleCRow = {
  category: string;
  debits: number;
  credits: number;
  scheduleCAmount: number;
  treatment: string;
  lineCount: number;
};

function scheduleCTreatment(category: string) {
  const accountNumber = coaAccountNumber(category);
  if (accountNumber === 100) return "Gross receipts";
  if (accountNumber === 101) return "Cost of goods sold";
  if (accountNumber != null && accountNumber >= 200 && accountNumber < 300) {
    return "Other expense";
  }
  return "Excluded from Schedule C";
}

function scheduleCAmount(category: string, debits: number, credits: number) {
  const accountNumber = coaAccountNumber(category);
  if (accountNumber === 100) return roundMoney(credits - debits);
  if (
    accountNumber === 101 ||
    (accountNumber != null && accountNumber >= 200 && accountNumber < 300)
  ) {
    return roundMoney(debits - credits);
  }
  return 0;
}

export default function ScheduleCPage() {
  const currentYear = String(new Date().getFullYear());
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccount[]>([]);
  const [year, setYear] = useState(currentYear);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const [{ data: ledgerData, error: ledgerError }, { data: coaData, error: coaError }] =
      await Promise.all([
        supabase.from("ledger").select("*").limit(10000),
        supabase
          .from("chart_of_accounts")
          .select("*")
          .order("category", { ascending: true }),
      ]);

    if (ledgerError || coaError) {
      setLoadError(ledgerError?.message ?? coaError?.message ?? "Could not load report.");
      setEntries([]);
      setChartOfAccounts([]);
    } else {
      setEntries((ledgerData ?? []).map((row) => normalizeLedgerRow(row)));
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

  const filteredEntries = useMemo(
    () => entries.filter((entry) => entry.entry_date.startsWith(`${year}-`)),
    [entries, year]
  );

  const rows = useMemo<ScheduleCRow[]>(() => {
    const categories = new Set(
      chartOfAccounts.map((account) => account.category.trim()).filter(Boolean)
    );
    for (const entry of filteredEntries) {
      categories.add(entry.coa_category?.trim() || "Uncategorized");
    }

    return [...categories]
      .map((category) => {
        const categoryEntries = filteredEntries.filter(
          (entry) => (entry.coa_category?.trim() || "Uncategorized") === category
        );
        const debits = roundMoney(
          categoryEntries.reduce(
            (sum, entry) => sum + Number(entry.debit_amount ?? 0),
            0
          )
        );
        const credits = roundMoney(
          categoryEntries.reduce(
            (sum, entry) => sum + Number(entry.credit_amount ?? 0),
            0
          )
        );
        const scheduleEntries = categoryEntries.filter(
          (entry) => !entry.balance_sheet
        );
        const scheduleDebits = roundMoney(
          scheduleEntries.reduce(
            (sum, entry) => sum + Number(entry.debit_amount ?? 0),
            0
          )
        );
        const scheduleCredits = roundMoney(
          scheduleEntries.reduce(
            (sum, entry) => sum + Number(entry.credit_amount ?? 0),
            0
          )
        );

        return {
          category,
          debits,
          credits,
          scheduleCAmount: scheduleCAmount(
            category,
            scheduleDebits,
            scheduleCredits
          ),
          treatment: scheduleCTreatment(category),
          lineCount: categoryEntries.length,
        };
      })
      .sort((a, b) => {
        const aNumber = coaAccountNumber(a.category) ?? Number.MAX_SAFE_INTEGER;
        const bNumber = coaAccountNumber(b.category) ?? Number.MAX_SAFE_INTEGER;
        return aNumber - bNumber || a.category.localeCompare(b.category);
      });
  }, [chartOfAccounts, filteredEntries]);

  const totals = useMemo(() => {
    let grossReceipts = 0;
    let cogs = 0;
    let otherExpenses = 0;
    for (const row of rows) {
      const accountNumber = coaAccountNumber(row.category);
      if (accountNumber === 100) grossReceipts += row.scheduleCAmount;
      else if (accountNumber === 101) cogs += row.scheduleCAmount;
      else if (accountNumber != null && accountNumber >= 200 && accountNumber < 300) {
        otherExpenses += row.scheduleCAmount;
      }
    }
    grossReceipts = roundMoney(grossReceipts);
    cogs = roundMoney(cogs);
    otherExpenses = roundMoney(otherExpenses);
    return {
      grossReceipts,
      cogs,
      otherExpenses,
      netProfit: roundMoney(grossReceipts - cogs - otherExpenses),
    };
  }, [rows]);

  return (
    <AppShell>
      <PageHeader
        title="Schedule C Report"
        description="Chart of accounts breakout for business income and expenses."
      />

      <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
              ["Gross Receipts", totals.grossReceipts],
              ["Cost of Goods Sold", -totals.cogs],
              ["Other Expenses", -totals.otherExpenses],
              ["Net Profit", totals.netProfit],
            ].map(([label, amount]) => (
              <div
                key={String(label)}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="text-xs font-bold uppercase tracking-wide text-slate-700">
                  {label}
                </p>
                <p
                  className={`mt-1 text-xl font-semibold ${
                    Number(amount) < 0
                      ? "text-red-700"
                      : Number(amount) > 0
                        ? "text-emerald-700"
                        : "text-slate-900"
                  }`}
                >
                  {formatCurrency(Number(amount))}
                </p>
              </div>
            ))}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-4 text-sm text-slate-600">
              Uses posted debit and credit amounts by entry date. Balance-sheet,
              equity (300-series), and liability (400-series) activity is shown for
              review but excluded from Schedule C net profit. Per Designer is half
              of the Schedule C amount.
            </p>
            <DataTable
              stickyHeader
              mobileTitleKey="category"
              columns={[
                { key: "category", label: "CoA Category" },
                { key: "treatment", label: "Schedule C Treatment" },
                { key: "lines", label: "Lines" },
                { key: "debits", label: "Debits" },
                { key: "credits", label: "Credits" },
                { key: "scheduleC", label: "Schedule C Amount" },
                { key: "perDesigner", label: "Per Designer" },
              ]}
              rows={rows.map((row) => ({
                category: row.category,
                treatment: row.treatment,
                lines: row.lineCount,
                debits: formatCurrency(row.debits),
                credits: formatCurrency(row.credits),
                scheduleC:
                  row.treatment === "Excluded from Schedule C"
                    ? "—"
                    : formatCurrency(row.scheduleCAmount),
                perDesigner:
                  row.treatment === "Excluded from Schedule C"
                    ? "—"
                    : formatCurrency(roundMoney(row.scheduleCAmount / 2)),
              }))}
              emptyMessage="No chart of accounts categories found."
            />
          </section>
        </>
      )}
    </AppShell>
  );
}
