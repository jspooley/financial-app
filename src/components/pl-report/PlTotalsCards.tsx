"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
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

function signedAmountClass(value: number) {
  if (value < 0) return "text-red-700";
  if (value > 0) return "text-emerald-700";
  return "text-slate-900";
}

function FormulaOperator({ symbol }: { symbol: string }) {
  return (
    <div
      className="flex items-center justify-center py-0.5 sm:px-0.5"
      aria-hidden
    >
      <span className="text-xl font-semibold text-slate-400 sm:text-2xl">
        {symbol}
      </span>
    </div>
  );
}

type DetailView = "expenses" | null;

function FormulaCard({
  label,
  value,
  hint,
  belowValue,
  emphasize,
  children,
  asButton,
  selected,
  onClick,
}: {
  label: string;
  value: number;
  hint?: ReactNode;
  belowValue?: ReactNode;
  emphasize?: boolean;
  children?: ReactNode;
  asButton?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  const className = `min-w-0 flex-1 rounded-lg border p-4 ${
    emphasize
      ? "border-brand-200 bg-brand-50"
      : selected
        ? "border-brand-400 bg-brand-50 ring-2 ring-brand-200"
        : "border-slate-100 bg-slate-50"
  } ${asButton ? "text-left transition hover:border-brand-200" : ""}`;
  const body = (
    <>
      <p
        className={`uppercase tracking-wide text-slate-500 ${
          emphasize ? "text-sm font-semibold text-slate-700" : "text-xs"
        }`}
      >
        {label}
      </p>
      <p
        className={`mt-1 font-bold tabular-nums ${
          emphasize ? "text-2xl" : "text-xl font-semibold"
        } ${signedAmountClass(value)}`}
      >
        {formatCurrency(value)}
      </p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {belowValue}
      {children}
    </>
  );
  if (asButton) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

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

  const canCompareGrossProfitGoal = tradePartnerCount > 0;
  const grossProfitVsGoal = roundMoney(
    totals.grossProfitMargin - grossProfitGoal
  );
  const belowGrossProfitGoal =
    canCompareGrossProfitGoal && grossProfitVsGoal < -0.005;
  const aboveGrossProfitGoal =
    canCompareGrossProfitGoal && grossProfitVsGoal > 0.005;
  const marginValueClass = signedAmountClass(totals.grossProfitMargin);
  const grossProfitVsGoalLabel = !canCompareGrossProfitGoal
    ? null
    : belowGrossProfitGoal
      ? `${formatPercent(Math.abs(grossProfitVsGoal))} below goal`
      : aboveGrossProfitGoal
        ? `${formatPercent(grossProfitVsGoal)} above goal`
        : "at goal";

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
      <div className="space-y-6">
        <div>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
            <FormulaCard
              label="Revenue"
              value={totals.revenue}
              hint="Customers paid invoices. Excludes S&U Tax."
            />
            <FormulaOperator symbol="+" />
            <FormulaCard
              label="Cost of Goods Sold"
              value={-totals.cogs}
              hint="Total designer cost. Uninvoiced debit costs are included in COGS only."
            />
            <FormulaOperator symbol="=" />
            <FormulaCard
              label="Gross Profit"
              value={totals.grossProfit}
              belowValue={
                <div className="mt-2 space-y-1">
                  <p className={`text-sm font-bold ${marginValueClass}`}>
                    GP Margin {formatPercent(totals.grossProfitMargin)}
                    {grossProfitVsGoalLabel
                      ? ` (${grossProfitVsGoalLabel})`
                      : ""}
                  </p>
                  <p className="text-sm leading-snug text-slate-600">
                    GP Margin Goal{" "}
                    <span className="font-semibold text-slate-900">
                      {tradePartnerCount === 0
                        ? "—"
                        : formatPercent(grossProfitGoal)}
                    </span>{" "}
                    (1/2 of avg Trade discount)
                  </p>
                  <p className="text-xs text-slate-500">
                    GP margin = GP ÷ revenue
                  </p>
                </div>
              }
              hint="GP = Revenue + COGS. Before expenses & loans."
              emphasize
            />
          </div>
        </div>

        <div>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
            <FormulaCard
              label="Gross Profit"
              value={totals.grossProfit}
              emphasize
            />
            <FormulaOperator symbol="+" />
            <FormulaCard
              label="Expense Amount"
              value={-totals.expenseAmount}
              hint={
                expenseLineCount === 0
                  ? "Expense amount + shipping + fees + tax remittances. No expense components recorded."
                  : `Expense amount + shipping + fees + tax remittances. ${expenseLineCount} ledger ${
                      expenseLineCount === 1 ? "line" : "lines"
                    }.`
              }
              asButton
              selected={detailView === "expenses"}
              onClick={() => toggleDetail("expenses")}
            >
              <p className="mt-2 text-xs font-medium text-brand-700">
                {detailView === "expenses"
                  ? "Hide ledger lines"
                  : "Click to list ledger lines"}
              </p>
            </FormulaCard>
            <FormulaOperator symbol="+" />
            <FormulaCard
              label="Business Debt"
              value={totals.businessDebt}
              hint="Same total as the Business Debt report"
            >
              <p className="mt-2 text-xs font-medium text-brand-700">
                <Link href="/debt-tracking" className="hover:underline">
                  Open Business Debt →
                </Link>
              </p>
            </FormulaCard>
            <FormulaOperator symbol="=" />
            <FormulaCard
              label="Net Profit"
              value={totals.netProfit}
              belowValue={
                <div className="mt-2 space-y-1">
                  <p
                    className={`text-sm font-bold ${signedAmountClass(totals.netProfitMargin)}`}
                  >
                    NP Margin {formatPercent(totals.netProfitMargin)}
                  </p>
                  <p className="text-xs text-slate-500">
                    NP margin = NP ÷ revenue
                  </p>
                </div>
              }
              hint="NP = GP + expenses + business debt"
              emphasize
            />
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
