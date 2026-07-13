"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { formatCurrency, formatDate, formatPercent, roundMoney } from "@/lib/utils";
import type { PlTotals } from "@/lib/pl-report";

export type PlExpenseDetailRow = {
  id: string;
  entry_date: string;
  clientName: string;
  description: string;
  po_number: string | null;
  expense_amount: number;
  shipping_receiving_amount: number;
  payment_fee: number;
  tax_amount: number;
  expenseTotal: number;
};

type DetailView = "expenses" | null;

interface PlTotalsCardsProps {
  totals: PlTotals;
  expenseLineCount: number;
  grossProfitGoal: number;
  tradePartnerCount: number;
  expenseRows: PlExpenseDetailRow[];
}

export function PlTotalsCards({
  totals,
  expenseLineCount,
  grossProfitGoal,
  tradePartnerCount,
  expenseRows,
}: PlTotalsCardsProps) {
  const [detailView, setDetailView] = useState<DetailView>(null);

  const belowGrossProfitGoal =
    tradePartnerCount > 0 && totals.grossProfitMargin < grossProfitGoal;
  const grossProfitGap = roundMoney(grossProfitGoal - totals.grossProfitMargin);
  const belowGoalValueClass = belowGrossProfitGoal ? "text-red-700" : "text-brand-800";

  const expenseTotalFromRows = useMemo(
    () =>
      roundMoney(
        expenseRows.reduce((sum, row) => sum + Number(row.expenseTotal), 0)
      ),
    [expenseRows]
  );

  function toggleDetail(view: Exclude<DetailView, null>) {
    setDetailView((current) => (current === view ? null : view));
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 sm:gap-4">
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Revenue</p>
          <p className="mt-1 text-xl font-semibold text-brand-800">
            {formatCurrency(totals.revenue)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Cost of Goods Sold
          </p>
          <p className="mt-1 text-xl font-semibold text-slate-900">
            {formatCurrency(totals.cogs)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => toggleDetail("expenses")}
          className={`rounded-lg border p-4 text-left transition ${
            detailView === "expenses"
              ? "border-brand-400 bg-brand-50 ring-2 ring-brand-200"
              : "border-slate-100 bg-slate-50 hover:border-brand-200"
          }`}
        >
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Expense Amount
          </p>
          <p className="mt-1 text-xl font-semibold text-slate-900">
            {formatCurrency(totals.expenseAmount)}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {expenseLineCount === 0
              ? "No expense components recorded"
              : `Expense, shipping, fees & tax across ${expenseLineCount} ledger ${
                  expenseLineCount === 1 ? "line" : "lines"
                }`}
          </p>
          <p className="mt-2 text-xs font-medium text-brand-700">
            {detailView === "expenses" ? "Hide ledger lines" : "Click to list ledger lines"}
          </p>
        </button>
        <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-3 sm:gap-4 xl:col-span-3">
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
            <p className="text-sm font-semibold leading-snug text-slate-700">
              GROSS PROFIT GOAL
            </p>
            <p className="mt-2 text-2xl font-bold text-brand-800">
              {tradePartnerCount === 0 ? "—" : formatPercent(grossProfitGoal)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Half of average trade discount
            </p>
          </div>
          <div
            className={`rounded-lg border p-4 ${
              belowGrossProfitGoal
                ? "border-red-200 bg-red-50"
                : "border-brand-200 bg-brand-50"
            }`}
          >
            <p className="text-sm font-semibold leading-snug text-slate-700">
              GROSS PROFIT MARGIN
            </p>
            <p className={`mt-2 text-2xl font-bold ${belowGoalValueClass}`}>
              {formatPercent(totals.grossProfitMargin)}
              {belowGrossProfitGoal ? (
                <span className="ml-2 text-xl font-semibold">
                  ({formatPercent(grossProfitGap)})
                </span>
              ) : null}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {belowGrossProfitGoal
                ? `${formatPercent(grossProfitGap)} below goal`
                : tradePartnerCount > 0
                  ? "At or above gross profit goal"
                  : "Profit after direct costs"}
            </p>
          </div>
          <div
            className={`rounded-lg border p-4 ${
              belowGrossProfitGoal
                ? "border-red-200 bg-red-50"
                : "border-brand-200 bg-brand-50"
            }`}
          >
            <p className="text-sm font-semibold leading-snug text-slate-700">
              GROSS PROFIT
              <br />
              <span className="text-xs font-medium text-slate-500">
                (before expenses &amp; loans)
              </span>
            </p>
            <p className={`mt-2 text-2xl font-bold ${belowGoalValueClass}`}>
              {formatCurrency(totals.grossProfit)}
            </p>
          </div>
          <div className="hidden sm:block" aria-hidden="true" />
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
            <p className="text-sm font-semibold leading-snug text-slate-700">
              NET PROFIT MARGIN
            </p>
            <p className="mt-2 text-2xl font-bold text-brand-800">
              {formatPercent(totals.netProfitMargin)}
            </p>
            <p className="mt-1 text-xs text-slate-500">Net profit ÷ revenue</p>
          </div>
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
            <p className="text-sm font-semibold leading-snug text-slate-700">
              NET PROFIT
            </p>
            <p className="mt-2 text-2xl font-bold text-brand-800">
              {formatCurrency(totals.netProfit)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Revenue − (COGS + expenses + accepted underpayments)
            </p>
          </div>
        </div>
      </div>

      {detailView === "expenses" && (
        <DetailPanel
          title="Expense amount — ledger lines"
          subtitle="Expense amount + shipping + payment fees + tax (balance sheet lines excluded)."
          totalLabel="Expense total"
          total={expenseTotalFromRows}
          emptyMessage="No expense components in the current P&L year."
          onClose={() => setDetailView(null)}
          hasRows={expenseRows.length > 0}
        >
          <div className="space-y-3 md:hidden">
            {expenseRows.map((row) => (
              <article
                key={row.id}
                className="rounded-lg border border-slate-200 bg-white p-3 text-sm"
              >
                <p className="font-medium text-slate-900">{row.clientName}</p>
                <p className="text-slate-500">
                  {formatDate(row.entry_date)} · {row.po_number ?? "—"}
                </p>
                <p className="mt-1 text-slate-700">
                  {row.description.trim() || "—"}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-1 text-xs text-slate-600">
                  <div>Expense: {formatCurrency(row.expense_amount)}</div>
                  <div>Shipping: {formatCurrency(row.shipping_receiving_amount)}</div>
                  <div>Fee: {formatCurrency(row.payment_fee)}</div>
                  <div>Tax: {formatCurrency(row.tax_amount)}</div>
                </dl>
                <p className="mt-2 font-medium text-brand-800">
                  Line total: {formatCurrency(row.expenseTotal)}
                </p>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">PO</th>
                  <th className="px-3 py-2 text-right">Expense</th>
                  <th className="px-3 py-2 text-right">Shipping</th>
                  <th className="px-3 py-2 text-right">Fee</th>
                  <th className="px-3 py-2 text-right">Tax</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {expenseRows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatDate(row.entry_date)}
                    </td>
                    <td className="px-3 py-2">{row.clientName}</td>
                    <td className="px-3 py-2">{row.description.trim() || "—"}</td>
                    <td className="px-3 py-2">{row.po_number ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {formatCurrency(row.expense_amount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatCurrency(row.shipping_receiving_amount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatCurrency(row.payment_fee)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatCurrency(row.tax_amount)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {formatCurrency(row.expenseTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DetailPanel>
      )}
    </div>
  );
}

function DetailPanel({
  title,
  subtitle,
  totalLabel,
  total,
  emptyMessage,
  onClose,
  hasRows,
  children,
}: {
  title: string;
  subtitle: string;
  totalLabel: string;
  total: number;
  emptyMessage: string;
  onClose: () => void;
  hasRows: boolean;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              {totalLabel}
            </p>
            <p className="text-lg font-semibold text-brand-800">
              {formatCurrency(total)}
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      <div className="mt-4">
        {hasRows ? (
          children
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
            {emptyMessage}
          </p>
        )}
      </div>
    </div>
  );
}
