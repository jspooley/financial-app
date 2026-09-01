import type { InvoiceSelectedItemTotals } from "@/lib/invoice-utils";
import { formatCurrency } from "@/lib/utils";

export function InvoiceProfitValue({ amount }: { amount: number }) {
  return (
    <span
      className={`tabular-nums font-semibold ${
        amount < 0 ? "text-red-700" : "text-emerald-700"
      }`}
    >
      {formatCurrency(amount)}
    </span>
  );
}

interface InvoiceSelectedTotalsProps {
  totals: InvoiceSelectedItemTotals;
  title?: string;
  showHint?: boolean;
  hint?: string;
  className?: string;
}

export function InvoiceSelectedTotals({
  totals,
  title = "Selected items",
  showHint = true,
  hint,
  className,
}: InvoiceSelectedTotalsProps) {
  return (
    <div className={className}>
      {title ? (
        <p className="text-sm font-medium text-slate-700">{title}</p>
      ) : null}
      <dl
        className={`space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm ${
          title ? "mt-1.5" : ""
        }`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-slate-600">Total profit</dt>
          <dd>
            <InvoiceProfitValue amount={totals.profit} />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-slate-600">Total tax</dt>
          <dd className="tabular-nums font-semibold text-slate-900">
            {formatCurrency(totals.tax)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-slate-600">Total shipping</dt>
          <dd className="tabular-nums font-semibold text-slate-900">
            {formatCurrency(totals.shipping)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-slate-600">Total receiving</dt>
          <dd className="tabular-nums font-semibold text-slate-900">
            {formatCurrency(totals.receiving)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-slate-600">Total fees</dt>
          <dd className="tabular-nums font-semibold text-slate-900">
            {formatCurrency(totals.fees)}
          </dd>
        </div>
      </dl>
      {showHint ? (
        <p className="mt-1.5 text-xs text-slate-500">
          {hint ??
            "Profit is merchandise margin only (customer price minus designer total cost). Tax, shipping, receiving, and fees are excluded."}
        </p>
      ) : null}
    </div>
  );
}
