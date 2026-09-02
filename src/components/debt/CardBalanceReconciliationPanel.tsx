"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import type {
  CardBalanceBucketSummary,
  CardBalanceReconciliation,
  CardBalanceReconciliationLine,
  CardPaydownPairRow,
  CardPaydownPairStatus,
} from "@/lib/card-balance-reconciliation";
import { formatCurrency, formatDate } from "@/lib/utils";

const PAIR_STATUS_LABELS: Record<CardPaydownPairStatus, string> = {
  matched: "Matched",
  cluster: "Multi-charge 308",
  "missing-paydown": "No paydown",
  "missing-charge": "No charge",
  "amount-mismatch": "Amount mismatch",
};

function pairStatusClass(status: CardPaydownPairStatus) {
  if (status === "matched" || status === "cluster") {
    return "text-emerald-800";
  }
  return "text-amber-900";
}

function lineCell(line: CardBalanceReconciliationLine | null) {
  if (!line) {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <div className="space-y-0.5">
      <p className="font-medium text-slate-900">{formatDate(line.date)}</p>
      <p className="text-slate-700">{line.description}</p>
      <p className={`tabular-nums text-sm ${moneyClass(line.amount)}`}>
        {formatCurrency(line.amount)}
      </p>
    </div>
  );
}

function PairingTable({
  rows,
  showMatched,
}: {
  rows: CardPaydownPairRow[];
  showMatched: boolean;
}) {
  const visibleRows = showMatched
    ? rows
    : rows.filter((row) => row.status !== "matched" && row.status !== "cluster");

  return (
    <DataTable
      emptyMessage={
        showMatched
          ? "No reimbursed charges or card paydowns for this view."
          : "Every reimbursed charge has a matching card paydown."
      }
      columns={[
        { key: "status", label: "Status" },
        { key: "charge", label: "Reimbursed charge" },
        { key: "paydown", label: "Card paydown" },
        { key: "net", label: "Net on card", className: "text-right" },
        { key: "payment", label: "Checking 308" },
      ]}
      rows={visibleRows.map((row) => ({
        status: (
          <span className={`text-sm font-medium ${pairStatusClass(row.status)}`}>
            {PAIR_STATUS_LABELS[row.status]}
          </span>
        ),
        charge: lineCell(row.charge),
        paydown: lineCell(row.paydown),
        net: (
          <span className={`tabular-nums ${moneyClass(row.netOnCard)}`}>
            {formatCurrency(row.netOnCard)}
          </span>
        ),
        payment: (
          <span className="text-sm text-slate-600">
            {row.paymentLabel ?? "—"}
          </span>
        ),
      }))}
    />
  );
}

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
  const [showPairing, setShowPairing] = useState(false);
  const [showMatchedPairs, setShowMatchedPairs] = useState(false);
  const { paydownPairing } = reconciliation;
  const hasPairingRows = paydownPairing.rows.length > 0;
  const hasUnmatchedPairing =
    paydownPairing.unmatchedChargeCount > 0 ||
    paydownPairing.unmatchedPaydownCount > 0 ||
    paydownPairing.rows.some((row) => row.status === "amount-mismatch");

  useEffect(() => {
    if (hasUnmatchedPairing) setShowPairing(true);
  }, [hasUnmatchedPairing, reconciliation.partner]);
  const nonZeroBuckets = useMemo(
    () => reconciliation.buckets.filter((bucket) => Math.abs(bucket.total) >= 0.005),
    [reconciliation.buckets]
  );
  const explainBuckets = useMemo(
    () =>
      reconciliation.buckets.filter(
        (bucket) =>
          bucket.key !== "unreimbursed" && Math.abs(bucket.total) >= 0.005
      ),
    [reconciliation.buckets]
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
            Why Cashflow&apos;s card balance can differ from Business Debt for{" "}
            {partnerLabel}. Buckets below sum to the card balance.
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
            {reconciliation.buckets.map((bucket) => (
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
            <tr className="border-t-2 border-slate-200">
              <td className="py-2 pr-4 font-semibold text-slate-900">
                Credit card balance
              </td>
              <td
                className={`py-2 text-right tabular-nums font-semibold whitespace-nowrap ${moneyClass(
                  reconciliation.creditCardBalance,
                  true
                )}`}
              >
                {formatCurrency(reconciliation.creditCardBalance)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {Math.abs(reconciliation.creditCardBalance) >= 0.005 &&
      reconciliation.buckets.find((bucket) => bucket.key === "unreimbursed")
        ?.total === 0 &&
      explainBuckets.length > 0 ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Business Debt is $0 because every personal-card purchase is linked to a
          308, but{" "}
          <span className="font-medium">
            {formatCurrency(
              explainBuckets.reduce((sum, bucket) => sum + bucket.total, 0)
            )}
          </span>{" "}
          of card register activity is not unreimbursed debt. Expand the rows
          above to see what is still on the card.
        </p>
      ) : null}

      {nonZeroBuckets.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No credit card register activity for this view.
        </p>
      ) : null}

      {expandedBucket ? (
        <div className="mt-4 border-t border-slate-100 pt-4">
          {reconciliation.buckets
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

      {hasPairingRows ? (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Charge ↔ paydown matching
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Each reimbursed purchase should pair with a card paydown from the
                same checking 308. Rows without a match explain leftover card
                balance.
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {paydownPairing.matchedCount} matched pair
                {paydownPairing.matchedCount === 1 ? "" : "s"}
                {paydownPairing.unmatchedChargeCount > 0
                  ? ` · ${paydownPairing.unmatchedChargeCount} charge${
                      paydownPairing.unmatchedChargeCount === 1 ? "" : "s"
                    } without paydown (${formatCurrency(
                      paydownPairing.unmatchedChargeTotal
                    )})`
                  : ""}
                {paydownPairing.unmatchedPaydownCount > 0
                  ? ` · ${paydownPairing.unmatchedPaydownCount} paydown${
                      paydownPairing.unmatchedPaydownCount === 1 ? "" : "s"
                    } without charge (${formatCurrency(
                      paydownPairing.unmatchedPaydownTotal
                    )})`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="text-xs font-medium text-brand-700 underline"
                onClick={() => setShowPairing((current) => !current)}
              >
                {showPairing ? "Hide matching" : "Show matching"}
              </button>
              {showPairing ? (
                <button
                  type="button"
                  className="text-xs font-medium text-brand-700 underline"
                  onClick={() => setShowMatchedPairs((current) => !current)}
                >
                  {showMatchedPairs ? "Unmatched only" : "Show all pairs"}
                </button>
              ) : null}
            </div>
          </div>

          {hasUnmatchedPairing && !showPairing ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Some reimbursed charges and card paydowns do not pair up. Open{" "}
              <span className="font-medium">Show matching</span> to see which
              rows are missing a match.
            </p>
          ) : null}

          {showPairing ? (
            <div className="mt-3">
              <PairingTable
                rows={paydownPairing.rows}
                showMatched={showMatchedPairs}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
