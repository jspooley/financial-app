import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatPercent, roundMoney, sumLedgerCreditsAndDebits } from "@/lib/utils";
import { normalizeLedgerRow } from "@/lib/ledger-db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PlReportPage() {
  const supabase = await createClient();

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

  const ledgerBalances = sumLedgerCreditsAndDebits(allLedgerEntries, { invoicedPoKeys });
  const revenue = ledgerBalances.credits;
  const netBalance = revenue - ledgerBalances.debits;
  const grossProfitMargin =
    revenue > 0 ? roundMoney((netBalance / revenue) * 100) : 0;
  const totalExpenseAmount = roundMoney(
    allLedgerEntries.reduce((sum, entry) => sum + Number(entry.expense_amount ?? 0), 0)
  );
  const expenseCount = allLedgerEntries.filter(
    (entry) => Number(entry.expense_amount ?? 0) > 0
  ).length;

  return (
    <AppShell>
      <PageHeader
        title="P&L Report"
        description="Revenue, cost of goods sold, expenses, and gross profit from ledger activity."
      />

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">P&amp;L Details</h2>
        <p className="mt-1 text-sm text-slate-600">
          For each invoiced line: <strong>Revenue</strong> = payments received,{" "}
          <strong>Cost of goods sold</strong> = total designer cost.{" "}
          <strong>Gross profit</strong> = revenue − cost (before expenses &amp; loans).
          Uninvoiced debit costs are included in cost of goods sold only.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5 sm:gap-4">
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Revenue</p>
            <p className="mt-1 text-xl font-semibold text-brand-800">
              {formatCurrency(revenue)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Cost of Goods Sold</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {formatCurrency(ledgerBalances.debits)}
            </p>
          </div>
          <Link
            href="/payments"
            className="rounded-lg border border-slate-100 bg-slate-50 p-4 transition hover:border-brand-200"
          >
            <p className="text-xs uppercase tracking-wide text-slate-500">Expense Amount</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {formatCurrency(totalExpenseAmount)}
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
              {formatCurrency(netBalance)}
            </p>
          </div>
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
            <p className="text-sm font-semibold leading-snug text-slate-700">
              GROSS PROFIT MARGIN
            </p>
            <p className="mt-2 text-2xl font-bold text-brand-800">
              {formatPercent(grossProfitMargin)}
            </p>
            <p className="mt-1 text-xs text-slate-500">Profit after direct costs</p>
          </div>
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
    </AppShell>
  );
}
