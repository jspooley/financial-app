"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import type {
  CardBalanceBucketSummary,
  CardBalanceReconciliation,
} from "@/lib/card-balance-reconciliation";
import { formatCurrency, formatDate } from "@/lib/utils";

function moneyClass(value: number, emphasize = false) {
  const weight = emphasize ? "font-semibold" : "font-medium";
  const color =
    value < 0 ? "text-red-700" : value > 0 ? "text-emerald-700" : "text-slate-900";
  return `${weight} ${color}`;
}

function BucketLinesTable({ bucket }: { bucket: CardBalanceBucketSummary }) {
  return (
    <DataTable
      emptyMessage="No rows."
      columns={[
        { key: "date", label: "Date" },
        { key: "account", label: "Account" },
        { key: "description", label: "Description" },
        { key: "category", label: "CoA" },
        { key: "amount", label: "Net on card", className: "text-right" },
      ]}
      rows={bucket.lines.map((line) => ({
        date: formatDate(line.date),
        account: line.account,
        description: line.description,
        category: line.category,
        amount: (
          <span className={`tabular-nums ${moneyClass(line.amount)}`}>
            {formatCurrency(line.amount)}
          </span>
        ),
      }))}
      footerRow={{
        date: "Total",
        account: "",
        description: "",
        category: "",
        amount: (
          <span className={`tabular-nums ${moneyClass(bucket.total, true)}`}>
            {formatCurrency(bucket.total)}
          </span>
        ),
      }}
    />
  );
}

export function CardBalanceReconciliationPanel({
  reconciliation,
  filteredNote,
  compact = false,
  relatedHref = "/cashflow",
  relatedLabel = "Open Cashflow",
}: {
  reconciliation: CardBalanceReconciliation;
  filteredNote?: string;
  compact?: boolean;
  relatedHref?: string;
  relatedLabel?: string;
}) {
  const [expandedBucket, setExpandedBucket] = useState<string | null>(null);
  const visibleBuckets = useMemo(
    () =>
      reconciliation.buckets.filter(
        (bucket) =>
          bucket.key === "unreimbursed" || bucket.key === "reimbursed-charge"
      ),
    [reconciliation.buckets]
  );
  const nonZeroBuckets = useMemo(
    () => visibleBuckets.filter((bucket) => Math.abs(bucket.total) >= 0.005),
    [visibleBuckets]
  );

  const partnerLabel =
    reconciliation.partner === "Both"
      ? "Jess and Molly"
      : reconciliation.partner;

  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${
        compact ? "p-4" : "p-5"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            className={`font-semibold text-slate-900 ${
              compact ? "text-sm" : "text-lg"
            }`}
          >
            Credit card balance reconciliation
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Unpaid card charges for {partnerLabel}. Linked purchases are paid by
            checking and are not in this total.
          </p>
          {filteredNote ? (
            <p className="mt-1 text-xs text-amber-800">{filteredNote}</p>
          ) : null}
        </div>
        <Link
          href={relatedHref}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          {relatedLabel} →
        </Link>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <tbody>
            {visibleBuckets.map((bucket) => (
              <tr key={bucket.key} className="border-t border-slate-100">
                <td className="py-2 pr-4 align-top">
                  <p className="font-medium text-slate-900">{bucket.label}</p>
                  {!compact ? (
                    <p className="mt-0.5 text-xs leading-snug text-slate-500">
                      {bucket.hint}
                    </p>
                  ) : null}
                </td>
                <td
                  className={`py-2 text-right tabular-nums whitespace-nowrap ${moneyClass(bucket.total)}`}
                >
                  {formatCurrency(bucket.total)}
                </td>
                <td className="py-2 pl-3 text-right align-top">
                  {bucket.lines.length > 0 ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-brand-700 underline"
                      onClick={() =>
                        setExpandedBucket((current) =>
                          current === bucket.key ? null : bucket.key
                        )
                      }
                    >
                      {expandedBucket === bucket.key ? "Hide" : "Show"}{" "}
                      {bucket.lines.length}{" "}
                      {bucket.lines.length === 1 ? "row" : "rows"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {nonZeroBuckets.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No credit card register activity for this view.
        </p>
      ) : null}

      {expandedBucket ? (
        <div className="mt-4 border-t border-slate-100 pt-4">
          {visibleBuckets
            .filter((bucket) => bucket.key === expandedBucket)
            .map((bucket) => (
              <div key={bucket.key} className="space-y-2">
                <p className="text-sm font-medium text-slate-900">
                  {bucket.label}
                </p>
                <BucketLinesTable bucket={bucket} />
              </div>
            ))}
        </div>
      ) : null}
    </section>
  );
}
