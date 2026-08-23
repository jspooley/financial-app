"use client";

import { useState } from "react";
import Link from "next/link";
import { DataTable } from "@/components/ui/DataTable";
import type { BalanceSheetReviewItem } from "@/lib/pl-report";
import { formatCurrency, formatDate, roundMoney } from "@/lib/utils";

function signedCashAmount(debit: number, credit: number) {
  return roundMoney(credit - debit);
}

function formatSignedCash(value: number) {
  if (Math.abs(value) < 0.005) return "—";
  return (
    <span
      className={
        value < 0 ? "tabular-nums text-red-700" : "tabular-nums text-slate-900"
      }
    >
      {formatCurrency(value)}
    </span>
  );
}

export function BalanceSheetItems({
  items,
}: {
  items: BalanceSheetReviewItem[];
}) {
  const unexpectedCount = items.filter((item) => item.kind === "Unexpected")
    .length;
  const [showList, setShowList] = useState(unexpectedCount > 0);

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Balance Sheet items
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {items.length === 0 ? (
              "No rows are marked Balance Sheet. Personal-use goods and 300-series transfers/equity that are flagged that way are excluded from the P&L figures on this page."
            ) : (
              <>
                {items.length} {items.length === 1 ? "row is" : "rows are"}{" "}
                marked Balance Sheet and excluded from the P&amp;L figures on
                this page. Personal-use goods and 300-series transfers/equity
                are expected.{" "}
                {unexpectedCount === 0
                  ? "None look marked that way in error."
                  : `${unexpectedCount} ${
                      unexpectedCount === 1 ? "row does not" : "rows do not"
                    } match those categories — review those first. Edit the row on Cashflow to reset the flag from CoA.`}
              </>
            )}
          </p>
        </div>
        {items.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowList((current) => !current)}
            className="text-sm font-medium text-brand-700 hover:text-brand-900"
          >
            {showList ? "Hide list" : "Show list"}
          </button>
        ) : null}
      </div>
      {showList && items.length > 0 ? (
        <div className="mt-4">
          <DataTable
            stickyHeader
            maxBodyHeight="24rem"
            mobileTitleKey="date"
            emptyMessage="No Balance Sheet rows."
            columns={[
              { key: "date", label: "Date" },
              { key: "kind", label: "Why marked" },
              { key: "coa", label: "CoA Category" },
              { key: "description", label: "Description" },
              { key: "purchaser", label: "Purchased By" },
              { key: "amount", label: "Amount" },
            ]}
            rows={items.map(({ entry, kind }) => ({
              date: formatDate(entry.entry_date),
              kind:
                kind === "Unexpected" ? (
                  <span className="font-medium text-red-700">{kind}</span>
                ) : (
                  kind
                ),
              coa: entry.coa_category?.trim() || "—",
              description:
                entry.description?.trim() || entry.clients?.name || "—",
              purchaser: entry.purchaser,
              amount: formatSignedCash(
                signedCashAmount(
                  Number(entry.debit_amount ?? 0),
                  Number(entry.credit_amount ?? 0)
                )
              ),
            }))}
            rowKey={(_row, index) => items[index]?.entry.id ?? String(index)}
          />
        </div>
      ) : null}
      <p className="mt-4 text-sm">
        <Link
          href="/cashflow"
          className="font-medium text-brand-700 hover:text-brand-800 hover:underline"
        >
          Open Cashflow →
        </Link>
        <span className="text-slate-500">
          {" "}
          — edit a row to change its CoA and Balance Sheet flag
        </span>
      </p>
    </section>
  );
}
